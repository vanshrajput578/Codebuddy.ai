ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_id_user_id_uq ON agent_tasks(id,user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='agent_tasks_parent_owner_fk'
      AND conrelid='agent_tasks'::regclass
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_parent_owner_fk
      FOREIGN KEY (parent_task_id,user_id) REFERENCES agent_tasks(id,user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_task_id UUID NOT NULL,
  child_task_id UUID NOT NULL UNIQUE,
  agent_profile VARCHAR(32) NOT NULL CHECK (agent_profile IN ('researcher','developer','reviewer')),
  objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 2000),
  allowed_tools JSONB NOT NULL CHECK (jsonb_typeof(allowed_tools)='array' AND jsonb_array_length(allowed_tools) BETWEEN 1 AND 7),
  status VARCHAR(24) NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','awaiting_approval','running','paused','completed','failed','cancelled')),
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_delegations_parent_owner_fk
    FOREIGN KEY (parent_task_id,user_id) REFERENCES agent_tasks(id,user_id) ON DELETE CASCADE,
  CONSTRAINT agent_delegations_child_owner_fk
    FOREIGN KEY (child_task_id,user_id) REFERENCES agent_tasks(id,user_id) ON DELETE CASCADE,
  CONSTRAINT agent_delegations_distinct_tasks CHECK (parent_task_id <> child_task_id)
);

CREATE INDEX IF NOT EXISTS agent_delegations_parent_created_idx
  ON agent_delegations(user_id,parent_task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS agent_delegations_status_idx
  ON agent_delegations(status,updated_at DESC);
