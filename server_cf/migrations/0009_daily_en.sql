-- 每日一练·英语：今日单词/句子配置（按账号+日期，跨设备同步；结构镜像 daily_zh_config）
CREATE TABLE daily_en_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD（Asia/Shanghai）
  words TEXT NOT NULL DEFAULT '',     -- 今日单词，逗号/空格分隔
  sentences TEXT NOT NULL DEFAULT '', -- 今日句子，换行/分号分隔
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX ix_daily_en_user_date ON daily_en_config(user_id, date);
CREATE INDEX ix_daily_en_user ON daily_en_config(user_id);

-- 每日一练·英语：LLM 生成内容缓存（单词造句/释义、句子翻译/场景；每词每句只生成一次）
CREATE TABLE daily_en_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- 'word' | 'sentence'
  text TEXT NOT NULL,            -- 单词原词 / 句子原文（小写规范化后存储）
  content TEXT NOT NULL DEFAULT '{}', -- JSON：word→{translation,sentences:[{en,zh}]}；sentence→{translation,scene}
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX ix_daily_en_content_kind_text ON daily_en_content(kind, text);

-- 每日一练·英语：英文图片索引（按 单词/句子 精确匹配；数据库里没有就不显示图片，便于后续由运营/脚本灌图）
-- 图片文件存 R2 目录 data/english_images/，路由直读零 CPU。
CREATE TABLE english_image_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'word',   -- 'word' | 'sentence'
  text TEXT NOT NULL,                  -- 原词/原句（小写规范化后存储，便于精确匹配）
  image TEXT NOT NULL DEFAULT '',      -- R2 文件名（english_images 目录）
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX ix_english_image_index_kind_text ON english_image_index(kind, text);
