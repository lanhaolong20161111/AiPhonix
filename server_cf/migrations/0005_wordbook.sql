-- AiPhonix D1 migration 0005: 生词本（间隔重复 SRS）
-- 由 src/routes/wordbook.ts 读写；/module/wordbook 复习页消费。
-- 唯一键 (user_id, text)：重复添加刷新 next_review 不变、times+1。
CREATE TABLE wordbook_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  pinyin TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'chat',
  times INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  box INTEGER NOT NULL DEFAULT 1,
  next_review TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX ix_wordbook_user_text ON wordbook_item (user_id, text);
CREATE INDEX ix_wordbook_user_next ON wordbook_item (user_id, next_review);
