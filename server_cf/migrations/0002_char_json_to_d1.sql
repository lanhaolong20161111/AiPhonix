-- AiPhonix D1 migration 0002: char-image index/feedback + wordbank JSON -> D1 tables
-- (2026-08-31) 消除 R2 JSON 读改写竞态 与 跨 isolate 缓存不一致。
-- 数据由 scripts/seed_d1_from_json.mjs 从 R2 JSON 灌入（本文件仅建表）。

-- 认字索引：原 data/char_image_index.json（~3028 条）。
-- 核心列用于过滤/查询；extra 保存原对象中未建模字段（chinese/ipa/ipa_uk/phonemes/phonemes_uk...）。
CREATE TABLE char_image_index (
  char TEXT PRIMARY KEY,
  grade TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  pinyin TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_char_image_index_grade ON char_image_index (grade);
CREATE INDEX ix_char_image_index_type ON char_image_index (type);

-- 认字反馈：原 data/char_image_feedback.json（~709 条）。
-- 唯一键 (user_id, char, grade, semester, type) = 原"幂等合并"语义，UPSERT 原子化消竞态。
-- learning_status 可空（未标记）；extra 保留原对象中 feedback/original_version 等字段。
CREATE TABLE char_image_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  char TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  learning_status TEXT,
  needs_regen INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX uq_char_image_feedback_scope ON char_image_feedback (user_id, char, grade, semester, type);
CREATE INDEX ix_char_image_feedback_user ON char_image_feedback (user_id);
CREATE INDEX ix_char_image_feedback_char ON char_image_feedback (char);

-- 词库：原 data/wordbank.json（chars 0 + words 203 条）。
-- json 列整体保存原条目对象，保证 API 响应字节级一致（items 透传原字段）。
-- kind = 'chars' | 'words'（原数组归属）；text 为原条目主键（add-word 破坏式替换语义）。
CREATE TABLE wordbank_item (
  text TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'chars',
  json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_wordbank_item_kind ON wordbank_item (kind);