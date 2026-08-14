CREATE TABLE IF NOT EXISTS system_logs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  level       TEXT          NOT NULL,
  module      TEXT          NOT NULL,
  message     TEXT          NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- Index for efficient fetching by time
CREATE INDEX IF NOT EXISTS idx_system_logs_time ON system_logs (created_at DESC);
