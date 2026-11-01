ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS agent_profile VARCHAR(32) NOT NULL DEFAULT 'general';

ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS allowed_tools JSONB NOT NULL DEFAULT '["memory.search","memory.save","math.calculate","time.now","browser.open","terminal.run","response.compose"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='agent_tasks_profile_check'
      AND conrelid='agent_tasks'::regclass
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_profile_check
      CHECK (agent_profile IN ('general','researcher','developer','reviewer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='agent_tasks_allowed_tools_check'
      AND conrelid='agent_tasks'::regclass
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_allowed_tools_check
      CHECK (jsonb_typeof(allowed_tools)='array' AND jsonb_array_length(allowed_tools) BETWEEN 1 AND 8);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_tasks_profile_updated_idx
  ON agent_tasks(user_id,agent_profile,updated_at DESC);
