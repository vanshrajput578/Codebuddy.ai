import { randomUUID } from "node:crypto";

const DEFAULT_LEASE_MS = 30_000;
const MAX_WORKER_ATTEMPTS = 3;

export async function claimNextAgentTask(pool, workerId, leaseMs = DEFAULT_LEASE_MS) {
  if (!pool || typeof workerId !== "string" || !workerId.trim()) throw new Error("A database pool and worker ID are required.");
  if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) throw new Error("Lease duration must be between 5 and 300 seconds.");
  const client = await pool.connect();
  const leaseToken = randomUUID();
  try {
    await client.query("BEGIN");
    const exhausted = await client.query(
      `UPDATE agent_tasks
       SET status='failed',result='Worker lease expired too many times; task stopped for safety.',
           lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
       WHERE status='running' AND lease_expires_at < now() AND worker_attempts >= $1
       RETURNING id`,
      [MAX_WORKER_ATTEMPTS]
    );
    for (const task of exhausted.rows) {
      await client.query(
        "INSERT INTO agent_task_events (task_id,event_type,payload) VALUES ($1,'task.worker_retry_exhausted',$2::jsonb)",
        [task.id, JSON.stringify({ maxAttempts: MAX_WORKER_ATTEMPTS })]
      );
    }

    const claimed = await client.query(
      `WITH candidate AS (
         SELECT id
         FROM agent_tasks
         WHERE status='running'
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
           AND worker_attempts < $1
         ORDER BY updated_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE agent_tasks AS task
       SET lease_owner=$2,lease_token=$3::uuid,
           lease_expires_at=now() + ($4::text || ' milliseconds')::interval,
           worker_attempts=worker_attempts+1,updated_at=now()
       FROM candidate
       WHERE task.id=candidate.id
       RETURNING task.id,task.user_id,task.lease_token,task.worker_attempts,task.lease_expires_at`,
      [MAX_WORKER_ATTEMPTS, workerId, leaseToken, leaseMs]
    );
    await client.query("COMMIT");
    return claimed.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function heartbeatAgentTask(pool, taskId, leaseToken, leaseMs = DEFAULT_LEASE_MS) {
  const result = await pool.query(
    `UPDATE agent_tasks
     SET lease_expires_at=now() + ($3::text || ' milliseconds')::interval
     WHERE id=$1 AND lease_token=$2::uuid AND status='running'
     RETURNING id`,
    [taskId, leaseToken, leaseMs]
  );
  return result.rowCount === 1;
}

export async function releaseAgentTaskLease(pool, taskId, leaseToken) {
  const result = await pool.query(
    `UPDATE agent_tasks
     SET lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
     WHERE id=$1 AND lease_token=$2::uuid
     RETURNING id`,
    [taskId, leaseToken]
  );
  return result.rowCount === 1;
}

export function startAgentWorker({ pool, executeTask, workerId = randomUUID(), pollIntervalMs = 1_000, leaseMs = DEFAULT_LEASE_MS, onError = () => {} }) {
  if (typeof executeTask !== "function") throw new Error("Worker executeTask callback is required.");
  let stopped = false;
  let active = false;
  let timer = null;

  const wait = ms => new Promise(resolve => { timer = setTimeout(resolve, ms); });

  async function poll() {
    if (stopped || active) return;
    active = true;
    try {
      const task = await claimNextAgentTask(pool, workerId, leaseMs);
      if (task) {
        let leaseLost = false;
        const heartbeat = setInterval(async () => {
          try {
            if (!await heartbeatAgentTask(pool, task.id, task.lease_token, leaseMs)) leaseLost = true;
          } catch (error) {
            leaseLost = true;
            onError(error);
          }
        }, Math.max(1_000, Math.floor(leaseMs / 3)));
        try {
          await executeTask(task.id, task.user_id, task.lease_token, () => leaseLost);
        } finally {
          clearInterval(heartbeat);
          await releaseAgentTaskLease(pool, task.id, task.lease_token).catch(onError);
        }
      }
    } catch (error) {
      onError(error);
    } finally {
      active = false;
    }
  }

  async function loop() {
    while (!stopped) {
      await poll();
      if (!stopped) await wait(pollIntervalMs);
    }
  }

  const done = loop();
  return {
    workerId,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await done;
    }
  };
}

export const workerLimits = Object.freeze({ leaseMs: DEFAULT_LEASE_MS, maxAttempts: MAX_WORKER_ATTEMPTS });
