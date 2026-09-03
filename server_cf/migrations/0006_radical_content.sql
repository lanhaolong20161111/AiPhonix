-- AiPhonix D1 migration 0006: 偏旁魔法屋 LLM 内容缓存（儿歌/字谜）
-- 每个字族只生成一次，之后永远用缓存（控制 LLM 成本）。
-- kind: 'song' = AI 儿歌（content 为儿歌文本）；'riddle' = 字谜池（content 为 JSON 数组 [{riddle, answer}]）。
CREATE TABLE radical_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX ix_radical_content_family_kind ON radical_content (family, kind);
