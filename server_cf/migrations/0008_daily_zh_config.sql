-- 每日一练·语文：今日字/词/句/作文配置（按账号+日期，跨设备同步）
CREATE TABLE daily_zh_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD（Asia/Shanghai）
  chars TEXT NOT NULL DEFAULT '',
  words TEXT NOT NULL DEFAULT '',
  sentences TEXT NOT NULL DEFAULT '',
  essay_topic TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX ix_daily_zh_user_date ON daily_zh_config(user_id, date);
CREATE INDEX ix_daily_zh_user ON daily_zh_config(user_id);
