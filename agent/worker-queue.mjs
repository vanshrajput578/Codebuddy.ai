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
         SELECT id FROM agent_tasks
         WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < now())
           AND worker_attempts < $1
         ORDER BY updated_at ASC,created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE agent_tasks AS task
       SET lease_owner=$2,lease_token=$3::uuid,
           lease_expires_at=now()+($4::text || ' milliseconds')::interval,
           worker_attempts=worker_attempts+1,updated_at=now()
       FROM candidate WHERE task.id=candidate.id
       RETURNING task.id,task.user_id,task.lease_token,task.worker_attempts,task.lease_expires_at`,
      [MAX_WORKER_ATTEMPTS, workerId, leaseToken, leaseMs]
    );
    await client.query("COMMIT");
    return claimed.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function heartbeatAgentTask(pool, taskId, leaseToken, leaseMs = DEFAULT_LEASE_MS) {
  const result = await pool.query(
    `UPDATE agent_tasks SET lease_expires_at=now()+($3::text || ' milliseconds')::interval
     WHERE id=$1 AND lease_token=$2::uuid AND status='running' AND lease_expires_at>now()
     RETURNING id`,
    [taskId, leaseToken, leaseMs]
  );
  return result.rowCount === 1;
}

export async function releaseAgentTaskLease(pool, taskId, leaseToken) {
  const result = await pool.query(
    `UPDATE agent_tasks SET lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
     WHERE id=$1 AND lease_token=$2::uuid AND status='running' RETURNING id`,
    [taskId, leaseToken]
  );
  return result.rowCount === 1;
}

export function startAgentWorker({
  pool, executeTask, workerId = randomUUID(), pollIntervalMs = 1_000,
  leaseMs = DEFAULT_LEASE_MS, onError = () => {}
}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new Error("Worker database pool is required.");
  if (typeof executeTask !== "function") throw new Error("Worker executeTask callback is required.");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) throw new Error("Poll interval must be between 10 and 60000 milliseconds.");
  if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) throw new Error("Lease duration must be between 5 and 300 seconds.");

  let stopped = false;
  let active = false;
  let timer = null;
  let wakeWaiter = null;
  const stats = {
    startedAt: new Date().toISOString(), lastPollAt: null, lastClaimAt: null,
    lastHeartbeatAt: null, lastTaskFinishedAt: null, claims: 0,
    heartbeatSuccesses: 0, heartbeatFailures: 0, taskExecutions: 0,
    taskErrors: 0, activeTaskId: null, lastError: null
  };
  const reportError = error => {
    stats.taskErrors += 1;
    stats.lastError = { message: String(error?.message || error).slice(0, 300), at: new Date().toISOString() };
    try { onError(error); } catch {}
  };
  const wait = ms => new Promise(resolve => {
    wakeWaiter = resolve;
    timer = setTimeout(() => {
      timer = null;
      wakeWaiter = null;
      resolve();
    }, ms);
  });

  async function poll() {
    if (stopped || active) return;
    active = true;
    stats.lastPollAt = new Date().toISOString();
    try {
      const task = await claimNextAgentTask(pool, workerId, leaseMs);
      if (!task) { stats.lastError = null; return; }
      stats.lastError = null;
      stats.claims += 1;
      stats.lastClaimAt = new Date().toISOString();
      stats.activeTaskId = task.id;
      let leaseLost = false;
      let heartbeatRunning = false;
      let heartbeatTimer;
      const heartbeatDelay = Math.max(1_000, Math.floor(leaseMs / 3));
      const scheduleHeartbeat = () => {
        if (stopped && !stats.activeTaskId) return;
        heartbeatTimer = setTimeout(runHeartbeat, heartbeatDelay);
      };
      const runHeartbeat = async () => {
        if (heartbeatRunning || leaseLost) return;
        heartbeatRunning = true;
        try {
          const renewed = await heartbeatAgentTask(pool, task.id, task.lease_token, leaseMs);
          if (!renewed) {
            leaseLost = true;
            return;
          }
          stats.heartbeatSuccesses += 1;
          stats.lastError = null;
          stats.lastHeartbeatAt = new Date().toISOString();
        } catch (error) {
          stats.heartbeatFailures += 1;
          reportError(error);
          leaseLost = true;
        } finally {
          heartbeatRunning = false;
          if (!leaseLost) scheduleHeartbeat();
        }
      };
      scheduleHeartbeat();
      try {
        stats.taskExecutions += 1;
        await executeTask(task.id, task.user_id, task.lease_token, () => leaseLost);
      } catch (error) {
        reportError(error);
      } finally {
        clearTimeout(heartbeatTimer);
        await releaseAgentTaskLease(pool, task.id, task.lease_token).catch(reportError);
        stats.activeTaskId = null;
        stats.lastTaskFinishedAt = new Date().toISOString();
      }
    } catch (error) { reportError(error); }
    finally { active = false; }
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
    health: () => ({
      ok: !stopped && !stats.lastError,
      state: stopped ? "stopped" : active ? "busy" : "idle",
      workerId, leaseMs, pollIntervalMs, ...stats
    }),
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (wakeWaiter) { const wake = wakeWaiter; wakeWaiter = null; wake(); }
      await done;
    }
  };
}

export const workerLimits = Object.freeze({ leaseMs: DEFAULT_LEASE_MS, maxAttempts: MAX_WORKER_ATTEMPTS });
