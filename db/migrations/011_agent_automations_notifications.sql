CREATE TABLE IF NOT EXISTS agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 8000),
  agent_profile VARCHAR(32) NOT NULL CHECK (agent_profile IN ('general','researcher','developer','reviewer')),
  interval_minutes INTEGER CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN 15 AND 10080),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_schedules_id_user_uq UNIQUE (id,user_id)
);

CREATE INDEX IF NOT EXISTS agent_schedules_due_idx
  ON agent_schedules(enabled,next_run_at) WHERE enabled=TRUE;
CREATE INDEX IF NOT EXISTS agent_schedules_user_idx
  ON agent_schedules(user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL,
  user_id UUID NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  task_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_schedule_runs_schedule_time_uq UNIQUE (schedule_id,scheduled_for),
  CONSTRAINT agent_schedule_runs_schedule_owner_fk
    FOREIGN KEY (schedule_id,user_id) REFERENCES agent_schedules(id,user_id) ON DELETE CASCADE,
  CONSTRAINT agent_schedule_runs_task_owner_fk
    FOREIGN KEY (task_id,user_id) REFERENCES agent_tasks(id,user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS agent_schedule_runs_user_idx
  ON agent_schedule_runs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS agent_schedule_runs_task_idx
  ON agent_schedule_runs(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID,
  schedule_id UUID,
  schedule_run_id UUID UNIQUE,
  notification_type VARCHAR(32) NOT NULL CHECK (notification_type IN ('schedule.queued','task.awaiting_approval','task.completed','task.failed')),
  title VARCHAR(120) NOT NULL,
  body VARCHAR(500) NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_task_owner_fk
    FOREIGN KEY (task_id,user_id) REFERENCES agent_tasks(id,user_id) ON DELETE CASCADE,
  CONSTRAINT user_notifications_schedule_owner_fk
    FOREIGN KEY (schedule_id,user_id) REFERENCES agent_schedules(id,user_id) ON DELETE CASCADE,
  CONSTRAINT user_notifications_run_owner_fk
    FOREIGN KEY (schedule_run_id) REFERENCES agent_schedule_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx
  ON user_notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications(user_id,created_at DESC) WHERE read_at IS NULL;
