ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS replan_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_tasks'::regclass
      AND conname = 'agent_tasks_replan_count_range'
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_replan_count_range
      CHECK (replan_count BETWEEN 0 AND 2);
  END IF;
END $$;
