-- AiPhonix D1 migration 0004: 可观测性（🟡8）——请求/错误日志落 D1
-- 由 src/lib/observe.ts 写入（best-effort，不阻塞响应）；/api/v1/ops 查询。
-- 保留 7 天（写入时按 2% 概率执行清理，防止无限增长）。
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_request_logs_ts ON request_logs (ts);
CREATE INDEX ix_request_logs_status ON request_logs (status);
CREATE INDEX ix_request_logs_path ON request_logs (path);