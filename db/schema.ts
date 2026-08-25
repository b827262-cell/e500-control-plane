export const executionLogsTableSql = `
CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY,
  job_id TEXT NULL,
  workflow_id TEXT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT NULL,
  created_at TEXT NOT NULL
)`;

export const executionLogsWorkflowIndexSql = `
CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow_created_at
ON execution_logs(workflow_id, created_at DESC)`;

export const executionLogsJobIndexSql = `
CREATE INDEX IF NOT EXISTS idx_execution_logs_job_created_at
ON execution_logs(job_id, created_at DESC)`;

export const executionLogsSeedSql = `
INSERT INTO execution_logs (
  job_id,
  workflow_id,
  stage,
  status,
  level,
  source,
  message,
  detail,
  created_at
)
SELECT
  NULL,
  'flow-143e97030f654157',
  'workflow',
  'failed',
  'error',
  'control-plane',
  '無法讀取 workflow 結果：Failed to fetch',
  'flow_id=flow-143e97030f654157; query=/workflow flow-143e97030f654157',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM execution_logs
  WHERE workflow_id = 'flow-143e97030f654157'
    AND message = '無法讀取 workflow 結果：Failed to fetch'
)`;
