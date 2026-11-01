-- Phase 2: PostgreSQL-backed agent worker leases and bounded crash recovery.
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(120),
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_last_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='agent_tasks'::regclass AND conname='agent_tasks_worker_attempts_range'
  ) THEN
    ALTER TABLE agent_tasks
      ADD CONSTRAINT agent_tasks_worker_attempts_range CHECK (worker_attempts BETWEEN 0 AND 3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_tasks_worker_claim_idx
  ON agent_tasks(status, lease_expires_at, updated_at)
  WHERE status='running';
