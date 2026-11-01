import { getAgentDefinition } from "./agent-definitions.mjs";

const DEFAULT_INTERVAL_MS = 15_000;
const MAX_BATCH_SIZE = 50;

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Scheduler time must be a valid date.");
  return date;
}

export async function processDueAgentSchedules(pool, options = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required.");
  const now = validDate(options.now || new Date());
  const batchSize = options.batchSize === undefined ? 10 : options.batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("Scheduler batch size must be between 1 and 50.");
  }

  const client = await pool.connect();
  const queued = [];
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT id,user_id,title,prompt,agent_profile,interval_minutes,timezone,next_run_at
       FROM agent_schedules
       WHERE enabled=TRUE AND next_run_at <= $1
       ORDER BY next_run_at ASC,id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now, batchSize]
    );

    for (const schedule of due.rows) {
      const scheduledFor = validDate(schedule.next_run_at);
      const run = await client.query(
        `INSERT INTO agent_schedule_runs (schedule_id,user_id,scheduled_for,status)
         VALUES ($1,$2,$3,'queued')
         ON CONFLICT (schedule_id,scheduled_for) DO NOTHING
         RETURNING id`,
        [schedule.id, schedule.user_id, scheduledFor]
      );

      if (!run.rows[0]) {
        await client.query(
          `UPDATE agent_schedules
           SET next_run_at=CASE WHEN interval_minutes IS NULL THEN next_run_at
             ELSE $2 + make_interval(mins => interval_minutes) END,
             enabled=CASE WHEN interval_minutes IS NULL THEN FALSE ELSE enabled END,
             updated_at=now()
           WHERE id=$1 AND user_id=$3`,
          [schedule.id, now, schedule.user_id]
        );
        continue;
      }

      const profile = getAgentDefinition(schedule.agent_profile);
      const task = await client.query(
        `INSERT INTO agent_tasks (user_id,title,prompt,status,agent_profile,allowed_tools)
         VALUES ($1,$2,$3,'queued',$4,$5::jsonb)
         RETURNING id,title,status,agent_profile,created_at`,
        [schedule.user_id, schedule.title, schedule.prompt, profile.id, JSON.stringify(profile.allowedTools)]
      );
      const taskRow = task.rows[0];

      await client.query(
        `UPDATE agent_schedule_runs SET task_id=$1 WHERE id=$2 AND user_id=$3`,
        [taskRow.id, run.rows[0].id, schedule.user_id]
      );
      await client.query(
        `INSERT INTO agent_task_events (task_id,event_type,payload)
         VALUES ($1,'task.scheduled',$2::jsonb)`,
        [taskRow.id, JSON.stringify({ scheduleId: schedule.id, scheduleRunId: run.rows[0].id, scheduledFor: scheduledFor.toISOString(), timezone: schedule.timezone })]
      );
      await client.query(
        `INSERT INTO user_notifications (user_id,task_id,schedule_id,schedule_run_id,notification_type,title,body)
         VALUES ($1,$2,$3,$4,'schedule.queued',$5,$6)
         ON CONFLICT (schedule_run_id) DO NOTHING`,
        [schedule.user_id, taskRow.id, schedule.id, run.rows[0].id, "Scheduled task is ready", `${schedule.title} was queued. Review the generated plan and approve execution when ready.`]
      );
      await client.query(
        `UPDATE agent_schedules
         SET last_run_at=$2,
             next_run_at=CASE WHEN interval_minutes IS NULL THEN next_run_at
               ELSE $3 + make_interval(mins => interval_minutes) END,
             enabled=CASE WHEN interval_minutes IS NULL THEN FALSE ELSE enabled END,
             updated_at=now()
         WHERE id=$1 AND user_id=$4`,
        [schedule.id, scheduledFor, now, schedule.user_id]
      );
      queued.push({
        scheduleId: schedule.id,
        scheduleRunId: run.rows[0].id,
        userId: schedule.user_id,
        taskId: taskRow.id,
        title: taskRow.title,
        agentProfile: taskRow.agent_profile,
        scheduledFor: scheduledFor.toISOString()
      });
    }

    await client.query("COMMIT");
    return queued;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function startAgentScheduler({ pool, intervalMs = DEFAULT_INTERVAL_MS, batchSize = 10, onError = () => {} }) {
  if (!Number.isInteger(intervalMs) || intervalMs < 5_000 || intervalMs > 300_000) {
    throw new Error("Scheduler interval must be between 5 and 300 seconds.");
  }
  let stopped = false;
  let inFlight = false;
  let currentRun = Promise.resolve();

  const poll = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    currentRun = processDueAgentSchedules(pool, { batchSize })
      .catch(error => { onError(error); })
      .finally(() => { inFlight = false; });
  };

  const timer = setInterval(poll, intervalMs);
  timer.unref?.();
  poll();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await currentRun;
    }
  };
}
