-- Phase 4 agent runtime: safe additive migration.
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS current_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tasks_current_step_range'
      AND conrelid = 'agent_tasks'::regclass
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_current_step_range CHECK (current_step BETWEEN 0 AND 5);
  END IF;
END $$;
