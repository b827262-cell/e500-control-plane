CREATE INDEX IF NOT EXISTS idx_execution_logs_chain_event
ON execution_logs(workflow_id, stage, status, source, created_at DESC);
