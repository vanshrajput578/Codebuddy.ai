CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_id_user_id_uq ON agent_tasks(id, user_id);

CREATE TABLE IF NOT EXISTS agent_task_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  user_id UUID NOT NULL,
  path VARCHAR(240) NOT NULL,
  ciphertext TEXT NOT NULL,
  iv VARCHAR(32) NOT NULL,
  auth_tag VARCHAR(32) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 262144),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_task_files_task_path_uq UNIQUE (task_id, path),
  CONSTRAINT agent_task_files_task_owner_fk FOREIGN KEY (task_id, user_id)
    REFERENCES agent_tasks(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_task_files_user_task_idx
  ON agent_task_files(user_id, task_id, path);
