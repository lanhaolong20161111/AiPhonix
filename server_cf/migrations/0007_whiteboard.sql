-- AiPhonix D1 migration 0007: 白板运行时（OpenMAIC RuntimeStore 的 D1 版）
-- 由 src/lib/whiteboard-store.ts 读写；语义照搬 @openmaic/storage browser.js（IndexedDB 蓝本）：
-- 追加式 records（seq 会话内单调递增）、乐观并发（expectedLastSeq）、版本戳前向迁移。
CREATE TABLE wb_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  learner_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  runtime_dsl_version TEXT NOT NULL
);
CREATE INDEX ix_wb_sessions_stage_learner ON wb_sessions (stage_id, learner_key);
CREATE INDEX ix_wb_sessions_learner ON wb_sessions (learner_key);
CREATE INDEX ix_wb_sessions_stage ON wb_sessions (stage_id);
CREATE TABLE wb_records (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  scene_id TEXT,
  action_index INTEGER,
  sub_anchor TEXT,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX ix_wb_records_id ON wb_records (id);
