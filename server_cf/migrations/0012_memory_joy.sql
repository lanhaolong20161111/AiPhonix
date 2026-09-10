-- AiPhonix D1 migration 0012: 记忆快乐本（认字/练词的今日字词 → LLM 生成趣味文段）
-- 按账号+日期一行：同一天重新生成时由路由 upsert 覆盖（不产生历史垃圾）。
CREATE TABLE memory_joy_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD（Asia/Shanghai）
  chars TEXT NOT NULL DEFAULT '', -- 今日汉字原文（顿号/逗号分隔，前端高亮匹配用）
  words TEXT NOT NULL DEFAULT '', -- 今日词语原文
  title TEXT NOT NULL DEFAULT '', -- LLM 生成的文段标题
  text TEXT NOT NULL DEFAULT '',  -- LLM 生成的文段正文
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX ix_memory_joy_user_date ON memory_joy_entry(user_id, date);
CREATE INDEX ix_memory_joy_user ON memory_joy_entry(user_id);
