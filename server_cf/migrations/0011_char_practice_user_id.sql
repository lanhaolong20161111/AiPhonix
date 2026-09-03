-- AiPhonix D1 migration 0011: char_practice 改为按账号隔离 (user_id, char)
-- 背景：旧表仅按 char 唯一（全账号共享绿标/练习次数），且存有早期无归属测试数据
-- （passed=0）。改为每个账号独立记录：丢弃无归属旧数据，重建为 (user_id, char) 唯一，
-- 与 server_ts db/index.ts 的老库升级逻辑一致。
DROP INDEX IF EXISTS ix_char_practice_char;
ALTER TABLE char_practice RENAME TO char_practice_legacy;
CREATE TABLE char_practice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  char TEXT NOT NULL,
  pinyin_correct INTEGER NOT NULL DEFAULT 0,
  pinyin_wrong INTEGER NOT NULL DEFAULT 0,
  pronunciation_correct INTEGER NOT NULL DEFAULT 0,
  pronunciation_wrong INTEGER NOT NULL DEFAULT 0,
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  last_seen REAL,
  last_correct INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ix_char_practice_user_char ON char_practice (user_id, char);
CREATE INDEX ix_char_practice_user ON char_practice (user_id);
DROP TABLE char_practice_legacy;
