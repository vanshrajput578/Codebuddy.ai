-- Phase 1 Core Agent: increase the bounded plan size from five to eight steps.
ALTER TABLE agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_current_step_range;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_current_step_range
  CHECK (current_step BETWEEN 0 AND 8);
