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
  'flow-abfbbaa69b6247dc',
  'workflow',
  'failed',
  'error',
  'control-plane',
  '無法讀取 workflow 結果：Failed to fetch',
  'flow_id=flow-abfbbaa69b6247dc; query=/workflow flow-abfbbaa69b6247dc',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM execution_logs
  WHERE workflow_id = 'flow-abfbbaa69b6247dc'
    AND message = '無法讀取 workflow 結果：Failed to fetch'
);

PRAGMA optimize;
