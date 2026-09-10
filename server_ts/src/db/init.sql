-- 自动生成 (scripts/gen-init-sql.mts)：由 drizzle schema 派生的幂等建表 DDL。
-- 用途：server_ts 冷启动自愈 —— 全新 app.db 也能建出全部表，避免首启 500。
-- 已存在的表/索引因 IF NOT EXISTS 不受影响。改了 schema 后重跑生成器即可。

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_practice_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  task TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_practice_turns (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  correction TEXT NOT NULL,
  praise TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS char_click_stats (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  char TEXT NOT NULL,
  click_count INTEGER NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS char_practice (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  char TEXT NOT NULL,
  pinyin_correct INTEGER NOT NULL,
  pinyin_wrong INTEGER NOT NULL,
  pronunciation_correct INTEGER NOT NULL,
  pronunciation_wrong INTEGER NOT NULL,
  consecutive_correct INTEGER NOT NULL,
  last_seen REAL,
  last_correct INTEGER NOT NULL,
  passed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS char_unknown_marks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  char TEXT NOT NULL,
  lesson TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS chinese_essay_knowledge (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  requirement TEXT NOT NULL,
  guide TEXT NOT NULL,
  goals TEXT NOT NULL,
  page TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  model_essay TEXT,
  good_words TEXT,
  image_path TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS chinese_fts USING fts5(content);

CREATE TABLE IF NOT EXISTS chinese_question_items (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  unit TEXT NOT NULL,
  lesson TEXT NOT NULL,
  page TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS chinese_reading_items (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL,
  lesson TEXT NOT NULL,
  category TEXT NOT NULL,
  page TEXT NOT NULL,
  passage TEXT NOT NULL,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS chinese_recitation_items (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  page TEXT NOT NULL,
  image_path TEXT NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS chinese_textbook_pages (
  id INTEGER PRIMARY KEY,
  page TEXT NOT NULL,
  unit TEXT NOT NULL,
  lesson TEXT NOT NULL,
  page_type TEXT NOT NULL,
  content TEXT NOT NULL,
  knowledge_points TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  image_path TEXT
);

CREATE TABLE IF NOT EXISTS chinese_unit_knowledge (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL,
  lesson TEXT NOT NULL,
  category TEXT NOT NULL,
  page TEXT NOT NULL,
  content TEXT NOT NULL,
  knowledge_points TEXT NOT NULL,
  question_types TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  image_path TEXT
);

CREATE TABLE IF NOT EXISTS courseware (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  text_original TEXT NOT NULL,
  text_ai_modified TEXT NOT NULL,
  score REAL NOT NULL,
  feedback TEXT NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_budget_day (
  date TEXT PRIMARY KEY,
  total_cost REAL NOT NULL,
  calls INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_call_log (
  id INTEGER PRIMARY KEY,
  time TEXT NOT NULL,
  caller TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  comp_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_yuan REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL,
  error TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  plan_item_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  count INTEGER NOT NULL,
  correct INTEGER,
  score REAL,
  duration_ms INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS quest_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL,
  sub_json TEXT,
  sub_level INTEGER
);

CREATE TABLE IF NOT EXISTS question_templates (
  id INTEGER PRIMARY KEY,
  signature TEXT NOT NULL,
  question_type TEXT NOT NULL,
  type_hint TEXT NOT NULL,
  sample_question TEXT NOT NULL,
  hit_count INTEGER NOT NULL,
  created_at NUMERIC NOT NULL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  device_info TEXT NOT NULL,
  expires_at NUMERIC NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS speech_eval_records (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  eval_type TEXT NOT NULL,
  ref_text TEXT NOT NULL,
  engine TEXT NOT NULL,
  total_accuracy REAL NOT NULL,
  total_fluency REAL NOT NULL,
  total_completion REAL NOT NULL,
  suggested_score REAL NOT NULL,
  details TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  session_count INTEGER NOT NULL,
  last_content TEXT NOT NULL,
  mistakes TEXT NOT NULL,
  mastered TEXT NOT NULL,
  updated_at NUMERIC NOT NULL,
  created_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS training_plans (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_records (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content TEXT NOT NULL,
  ocr_text TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  source TEXT,
  uploader TEXT,
  origin TEXT
);

CREATE TABLE IF NOT EXISTS user_imports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  meaning TEXT NOT NULL,
  tags TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS user_prefs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  prefs TEXT NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL,
  grade TEXT NOT NULL,
  age INTEGER NOT NULL,
  learning_level TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS visit_counts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  route TEXT NOT NULL,
  count INTEGER NOT NULL,
  updated_at NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  content TEXT NOT NULL,
  unit TEXT NOT NULL,
  lesson TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  links TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at NUMERIC NOT NULL,
  updated_at NUMERIC NOT NULL
);

-- 关键唯一索引（账号级隔离）
CREATE UNIQUE INDEX IF NOT EXISTS ix_visit_counts_user_route ON visit_counts (user_id, route);
CREATE UNIQUE INDEX IF NOT EXISTS ix_user_prefs_user_id ON user_prefs (user_id);
