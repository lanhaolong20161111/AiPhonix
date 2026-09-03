-- AiPhonix D1 init migration: full replica of app.db schema
-- (29 content tables + FTS5 virtual table + indexes; shadow tables excluded)
-- Source: shared/data/app.db sqlite_master dump (SQLAlchemy legacy + TS additions)
-- table: ai_chat_sessions
CREATE TABLE ai_chat_sessions (
	id INTEGER NOT NULL, 
	session_id VARCHAR(64) NOT NULL, 
	user_id INTEGER NOT NULL, 
	module VARCHAR(16) NOT NULL, 
	messages TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: ai_practice_sessions
CREATE TABLE ai_practice_sessions (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	content_type VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	task VARCHAR(32) NOT NULL, 
	plan_json TEXT NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: ai_practice_turns
CREATE TABLE ai_practice_turns (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	role VARCHAR(8) NOT NULL, 
	text TEXT NOT NULL, 
	correction TEXT NOT NULL, 
	praise TEXT NOT NULL, 
	audio_path VARCHAR(256) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: char_click_stats
CREATE TABLE char_click_stats (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	char VARCHAR(8) NOT NULL, 
	click_count INTEGER NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_char_click_user_char UNIQUE (user_id, char)
);

-- table: char_practice
CREATE TABLE char_practice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char TEXT NOT NULL,
  pinyin_correct INTEGER NOT NULL DEFAULT 0,
  pinyin_wrong INTEGER NOT NULL DEFAULT 0,
  pronunciation_correct INTEGER NOT NULL DEFAULT 0,
  pronunciation_wrong INTEGER NOT NULL DEFAULT 0,
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  last_seen REAL,
  last_correct INTEGER NOT NULL DEFAULT 0
);

-- table: char_unknown_marks
CREATE TABLE char_unknown_marks (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	char VARCHAR(8) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_char_unknown_user_char UNIQUE (user_id, char)
);

-- table: chinese_essay_knowledge
CREATE TABLE chinese_essay_knowledge (
	id INTEGER NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	title VARCHAR(64) NOT NULL, 
	topic VARCHAR(128) NOT NULL, 
	requirement TEXT NOT NULL, 
	guide TEXT NOT NULL, 
	goals TEXT NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, model_essay TEXT DEFAULT '', good_words TEXT DEFAULT '', image_path TEXT DEFAULT '', 
	PRIMARY KEY (id)
);

-- table: chinese_question_items
CREATE TABLE chinese_question_items (
	id INTEGER NOT NULL, 
	category VARCHAR(32) NOT NULL, 
	question TEXT NOT NULL, 
	answer TEXT NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: chinese_reading_items
CREATE TABLE chinese_reading_items (
	id INTEGER NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	category VARCHAR(32) NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	passage TEXT NOT NULL, 
	question TEXT NOT NULL, 
	question_type VARCHAR(32) NOT NULL, 
	answer TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: chinese_recitation_items
CREATE TABLE chinese_recitation_items (
	id INTEGER NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	title VARCHAR(64) NOT NULL, 
	author VARCHAR(32) NOT NULL, 
	kind VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	source_ref VARCHAR(64) NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	image_path VARCHAR(256) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: chinese_textbook_pages
CREATE TABLE chinese_textbook_pages (
	id INTEGER NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	page_type VARCHAR(32) NOT NULL, 
	content TEXT NOT NULL, 
	knowledge_points TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, image_path TEXT DEFAULT '', 
	PRIMARY KEY (id)
);

-- table: chinese_unit_knowledge
CREATE TABLE chinese_unit_knowledge (
	id INTEGER NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	category VARCHAR(32) NOT NULL, 
	page VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	knowledge_points TEXT NOT NULL, 
	question_types TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, image_path TEXT DEFAULT '', 
	PRIMARY KEY (id)
);

-- table: essays
CREATE TABLE essays (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	title VARCHAR(256) NOT NULL, 
	topic VARCHAR(256) NOT NULL, 
	audio_url VARCHAR(512) NOT NULL, 
	text_original TEXT NOT NULL, 
	text_ai_modified TEXT NOT NULL, 
	score FLOAT NOT NULL, 
	feedback TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: knowledge_relations
CREATE TABLE knowledge_relations (
	id INTEGER NOT NULL, 
	from_id INTEGER NOT NULL, 
	relation VARCHAR(24) NOT NULL, 
	to_id INTEGER NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: llm_budget_day
CREATE TABLE llm_budget_day (
  date TEXT PRIMARY KEY,
  total_cost REAL NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0
);

-- table: llm_call_log
CREATE TABLE llm_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  caller TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  user_prompt TEXT NOT NULL DEFAULT '',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  comp_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_yuan REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);

-- table: practice_sessions
CREATE TABLE practice_sessions (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	plan_item_id VARCHAR(64) NOT NULL, 
	feature VARCHAR(32) NOT NULL, 
	date VARCHAR(10) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	count INTEGER NOT NULL, 
	correct INTEGER, 
	score FLOAT, 
	duration_ms INTEGER NOT NULL, 
	metrics_json TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_practice_session_user_item_date UNIQUE (user_id, plan_item_id, date)
);

-- table: quest_sessions
CREATE TABLE quest_sessions (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	question TEXT NOT NULL, 
	plan_json TEXT NOT NULL, 
	history_json TEXT NOT NULL, 
	step_index INTEGER NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, sub_json TEXT DEFAULT '', sub_level INTEGER DEFAULT 0, 
	PRIMARY KEY (id)
);

-- table: question_templates
CREATE TABLE question_templates (
	id INTEGER NOT NULL, 
	signature VARCHAR(128) NOT NULL, 
	question_type VARCHAR(64) NOT NULL, 
	type_hint TEXT NOT NULL, 
	sample_question TEXT NOT NULL, 
	hit_count INTEGER NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, source VARCHAR(8) DEFAULT 'llm', 
	PRIMARY KEY (id)
);

-- table: refresh_tokens
CREATE TABLE refresh_tokens (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	token_hash VARCHAR(256) NOT NULL, 
	device_info VARCHAR(256) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (token_hash)
);

-- table: speech_eval_records
CREATE TABLE speech_eval_records (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	language VARCHAR(8) NOT NULL, 
	eval_type VARCHAR(16) NOT NULL, 
	ref_text TEXT NOT NULL, 
	engine VARCHAR(32) NOT NULL, 
	total_accuracy FLOAT NOT NULL, 
	total_fluency FLOAT NOT NULL, 
	total_completion FLOAT NOT NULL, 
	suggested_score FLOAT NOT NULL, 
	details TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, source VARCHAR(255) DEFAULT "", 
	PRIMARY KEY (id)
);

-- table: student_profiles
CREATE TABLE student_profiles (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	module VARCHAR(16) NOT NULL, 
	session_count INTEGER NOT NULL, 
	last_content TEXT NOT NULL, 
	mistakes TEXT NOT NULL, 
	mastered TEXT NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_student_profile_user_module UNIQUE (user_id, module)
);

-- table: training_plans
CREATE TABLE training_plans (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	title VARCHAR(64) NOT NULL, 
	items_json TEXT NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: upload_records
CREATE TABLE upload_records (
	id INTEGER NOT NULL, 
	kind VARCHAR(8) NOT NULL, 
	file_name VARCHAR(256) NOT NULL, 
	content TEXT NOT NULL, 
	ocr_text TEXT NOT NULL, 
	note VARCHAR(512) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, source VARCHAR(16) DEFAULT 'web', uploader VARCHAR(64) DEFAULT '', origin VARCHAR(256) DEFAULT '', 
	PRIMARY KEY (id)
);

-- table: user_imports
CREATE TABLE user_imports (
	id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	kind VARCHAR(16) NOT NULL, 
	text VARCHAR(256) NOT NULL, 
	pinyin VARCHAR(128) NOT NULL, 
	meaning VARCHAR(512) NOT NULL, 
	tags VARCHAR(256) NOT NULL, 
	payload TEXT NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- table: users
CREATE TABLE users (
	id INTEGER NOT NULL, 
	uuid VARCHAR(36) NOT NULL, 
	username VARCHAR(64) NOT NULL, 
	password_hash VARCHAR(256) NOT NULL, 
	nickname VARCHAR(64) NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	grade VARCHAR(16) NOT NULL, 
	age INTEGER NOT NULL, 
	learning_level VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (uuid)
);

-- table: wiki_pages
CREATE TABLE wiki_pages (
	id INTEGER NOT NULL, 
	title VARCHAR(128) NOT NULL, 
	page_type VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	unit VARCHAR(32) NOT NULL, 
	lesson VARCHAR(64) NOT NULL, 
	source_ref TEXT NOT NULL, 
	links TEXT NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

-- index: ix_ai_chat_sessions_session_id (on ai_chat_sessions)
CREATE UNIQUE INDEX ix_ai_chat_sessions_session_id ON ai_chat_sessions (session_id);

-- index: ix_ai_chat_sessions_user (on ai_chat_sessions)
CREATE INDEX ix_ai_chat_sessions_user ON ai_chat_sessions(user_id);

-- index: ix_ai_chat_sessions_user_id (on ai_chat_sessions)
CREATE INDEX ix_ai_chat_sessions_user_id ON ai_chat_sessions (user_id);

-- index: ix_ai_practice_sessions_status (on ai_practice_sessions)
CREATE INDEX ix_ai_practice_sessions_status ON ai_practice_sessions (status);

-- index: ix_ai_practice_sessions_user (on ai_practice_sessions)
CREATE INDEX ix_ai_practice_sessions_user ON ai_practice_sessions(user_id);

-- index: ix_ai_practice_sessions_user_id (on ai_practice_sessions)
CREATE INDEX ix_ai_practice_sessions_user_id ON ai_practice_sessions (user_id);

-- index: ix_ai_practice_turns_session (on ai_practice_turns)
CREATE INDEX ix_ai_practice_turns_session ON ai_practice_turns(session_id);

-- index: ix_ai_practice_turns_session_id (on ai_practice_turns)
CREATE INDEX ix_ai_practice_turns_session_id ON ai_practice_turns (session_id);

-- index: ix_char_click_stats_user_id (on char_click_stats)
CREATE INDEX ix_char_click_stats_user_id ON char_click_stats (user_id);

-- index: ix_char_click_user (on char_click_stats)
CREATE INDEX ix_char_click_user ON char_click_stats(user_id);

-- index: ix_char_practice_char (on char_practice)
CREATE UNIQUE INDEX ix_char_practice_char ON char_practice (char);

-- index: ix_char_unknown_marks_user_id (on char_unknown_marks)
CREATE INDEX ix_char_unknown_marks_user_id ON char_unknown_marks (user_id);

-- index: ix_char_unknown_user (on char_unknown_marks)
CREATE INDEX ix_char_unknown_user ON char_unknown_marks(user_id);

-- index: ix_chinese_essay_knowledge_title (on chinese_essay_knowledge)
CREATE INDEX ix_chinese_essay_knowledge_title ON chinese_essay_knowledge (title);

-- index: ix_chinese_essay_knowledge_unit (on chinese_essay_knowledge)
CREATE INDEX ix_chinese_essay_knowledge_unit ON chinese_essay_knowledge (unit);

-- index: ix_chinese_question_items_category (on chinese_question_items)
CREATE INDEX ix_chinese_question_items_category ON chinese_question_items (category);

-- index: ix_chinese_question_items_lesson (on chinese_question_items)
CREATE INDEX ix_chinese_question_items_lesson ON chinese_question_items (lesson);

-- index: ix_chinese_question_items_source (on chinese_question_items)
CREATE INDEX ix_chinese_question_items_source ON chinese_question_items (source);

-- index: ix_chinese_question_items_unit (on chinese_question_items)
CREATE INDEX ix_chinese_question_items_unit ON chinese_question_items (unit);

-- index: ix_chinese_reading_items_lesson (on chinese_reading_items)
CREATE INDEX ix_chinese_reading_items_lesson ON chinese_reading_items (lesson);

-- index: ix_chinese_reading_items_question_type (on chinese_reading_items)
CREATE INDEX ix_chinese_reading_items_question_type ON chinese_reading_items (question_type);

-- index: ix_chinese_reading_items_unit (on chinese_reading_items)
CREATE INDEX ix_chinese_reading_items_unit ON chinese_reading_items (unit);

-- index: ix_chinese_recitation_items_kind (on chinese_recitation_items)
CREATE INDEX ix_chinese_recitation_items_kind ON chinese_recitation_items (kind);

-- index: ix_chinese_recitation_items_title (on chinese_recitation_items)
CREATE INDEX ix_chinese_recitation_items_title ON chinese_recitation_items (title);

-- index: ix_chinese_recitation_items_unit (on chinese_recitation_items)
CREATE INDEX ix_chinese_recitation_items_unit ON chinese_recitation_items (unit);

-- index: ix_chinese_textbook_pages_lesson (on chinese_textbook_pages)
CREATE INDEX ix_chinese_textbook_pages_lesson ON chinese_textbook_pages (lesson);

-- index: ix_chinese_textbook_pages_page (on chinese_textbook_pages)
CREATE INDEX ix_chinese_textbook_pages_page ON chinese_textbook_pages (page);

-- index: ix_chinese_textbook_pages_page_type (on chinese_textbook_pages)
CREATE INDEX ix_chinese_textbook_pages_page_type ON chinese_textbook_pages (page_type);

-- index: ix_chinese_textbook_pages_unit (on chinese_textbook_pages)
CREATE INDEX ix_chinese_textbook_pages_unit ON chinese_textbook_pages (unit);

-- index: ix_chinese_unit_knowledge_category (on chinese_unit_knowledge)
CREATE INDEX ix_chinese_unit_knowledge_category ON chinese_unit_knowledge (category);

-- index: ix_chinese_unit_knowledge_lesson (on chinese_unit_knowledge)
CREATE INDEX ix_chinese_unit_knowledge_lesson ON chinese_unit_knowledge (lesson);

-- index: ix_chinese_unit_knowledge_unit (on chinese_unit_knowledge)
CREATE INDEX ix_chinese_unit_knowledge_unit ON chinese_unit_knowledge (unit);

-- index: ix_essay_knowledge_title (on chinese_essay_knowledge)
CREATE INDEX ix_essay_knowledge_title ON chinese_essay_knowledge(title);

-- index: ix_essay_knowledge_unit (on chinese_essay_knowledge)
CREATE INDEX ix_essay_knowledge_unit ON chinese_essay_knowledge(unit);

-- index: ix_essays_user_id (on essays)
CREATE INDEX ix_essays_user_id ON essays (user_id);

-- index: ix_knowledge_relations_from_id (on knowledge_relations)
CREATE INDEX ix_knowledge_relations_from_id ON knowledge_relations (from_id);

-- index: ix_knowledge_relations_relation (on knowledge_relations)
CREATE INDEX ix_knowledge_relations_relation ON knowledge_relations (relation);

-- index: ix_knowledge_relations_to_id (on knowledge_relations)
CREATE INDEX ix_knowledge_relations_to_id ON knowledge_relations (to_id);

-- index: ix_practice_sessions_date (on practice_sessions)
CREATE INDEX ix_practice_sessions_date ON practice_sessions (date);

-- index: ix_practice_sessions_feature (on practice_sessions)
CREATE INDEX ix_practice_sessions_feature ON practice_sessions (feature);

-- index: ix_practice_sessions_plan_item_id (on practice_sessions)
CREATE INDEX ix_practice_sessions_plan_item_id ON practice_sessions (plan_item_id);

-- index: ix_practice_sessions_user (on practice_sessions)
CREATE INDEX ix_practice_sessions_user ON practice_sessions(user_id);

-- index: ix_practice_sessions_user_id (on practice_sessions)
CREATE INDEX ix_practice_sessions_user_id ON practice_sessions (user_id);

-- index: ix_quest_sessions_user (on quest_sessions)
CREATE INDEX ix_quest_sessions_user ON quest_sessions(user_id);

-- index: ix_quest_sessions_user_id (on quest_sessions)
CREATE INDEX ix_quest_sessions_user_id ON quest_sessions (user_id);

-- index: ix_question_items_category (on chinese_question_items)
CREATE INDEX ix_question_items_category ON chinese_question_items(category);

-- index: ix_question_items_source (on chinese_question_items)
CREATE INDEX ix_question_items_source ON chinese_question_items(source);

-- index: ix_question_templates_signature (on question_templates)
CREATE UNIQUE INDEX ix_question_templates_signature ON question_templates (signature);

-- index: ix_reading_items_type (on chinese_reading_items)
CREATE INDEX ix_reading_items_type ON chinese_reading_items(question_type);

-- index: ix_reading_items_unit (on chinese_reading_items)
CREATE INDEX ix_reading_items_unit ON chinese_reading_items(unit);

-- index: ix_recitation_title (on chinese_recitation_items)
CREATE INDEX ix_recitation_title ON chinese_recitation_items(title);

-- index: ix_recitation_unit (on chinese_recitation_items)
CREATE INDEX ix_recitation_unit ON chinese_recitation_items(unit);

-- index: ix_refresh_tokens_user_id (on refresh_tokens)
CREATE INDEX ix_refresh_tokens_user_id ON refresh_tokens (user_id);

-- index: ix_relations_from (on knowledge_relations)
CREATE INDEX ix_relations_from ON knowledge_relations(from_id);

-- index: ix_relations_to (on knowledge_relations)
CREATE INDEX ix_relations_to ON knowledge_relations(to_id);

-- index: ix_speech_eval_language (on speech_eval_records)
CREATE INDEX ix_speech_eval_language ON speech_eval_records(language);

-- index: ix_speech_eval_records_created_at (on speech_eval_records)
CREATE INDEX ix_speech_eval_records_created_at ON speech_eval_records (created_at);

-- index: ix_speech_eval_records_eval_type (on speech_eval_records)
CREATE INDEX ix_speech_eval_records_eval_type ON speech_eval_records (eval_type);

-- index: ix_speech_eval_records_language (on speech_eval_records)
CREATE INDEX ix_speech_eval_records_language ON speech_eval_records (language);

-- index: ix_speech_eval_records_user_id (on speech_eval_records)
CREATE INDEX ix_speech_eval_records_user_id ON speech_eval_records (user_id);

-- index: ix_speech_eval_type (on speech_eval_records)
CREATE INDEX ix_speech_eval_type ON speech_eval_records(eval_type);

-- index: ix_speech_eval_user (on speech_eval_records)
CREATE INDEX ix_speech_eval_user ON speech_eval_records(user_id);

-- index: ix_student_profiles_user (on student_profiles)
CREATE INDEX ix_student_profiles_user ON student_profiles(user_id);

-- index: ix_student_profiles_user_id (on student_profiles)
CREATE INDEX ix_student_profiles_user_id ON student_profiles (user_id);

-- index: ix_textbook_lesson (on chinese_textbook_pages)
CREATE INDEX ix_textbook_lesson ON chinese_textbook_pages(lesson);

-- index: ix_textbook_page (on chinese_textbook_pages)
CREATE INDEX ix_textbook_page ON chinese_textbook_pages(page);

-- index: ix_training_plans_user_id (on training_plans)
CREATE UNIQUE INDEX ix_training_plans_user_id ON training_plans (user_id);

-- index: ix_unit_knowledge_category (on chinese_unit_knowledge)
CREATE INDEX ix_unit_knowledge_category ON chinese_unit_knowledge(category);

-- index: ix_unit_knowledge_lesson (on chinese_unit_knowledge)
CREATE INDEX ix_unit_knowledge_lesson ON chinese_unit_knowledge(lesson);

-- index: ix_unit_knowledge_unit (on chinese_unit_knowledge)
CREATE INDEX ix_unit_knowledge_unit ON chinese_unit_knowledge(unit);

-- index: ix_upload_records_created (on upload_records)
CREATE INDEX ix_upload_records_created ON upload_records(created_at);

-- index: ix_upload_records_created_at (on upload_records)
CREATE INDEX ix_upload_records_created_at ON upload_records (created_at);

-- index: ix_upload_records_source (on upload_records)
CREATE INDEX ix_upload_records_source ON upload_records (source);

-- index: ix_user_imports_created_at (on user_imports)
CREATE INDEX ix_user_imports_created_at ON user_imports (created_at);

-- index: ix_user_imports_kind (on user_imports)
CREATE INDEX ix_user_imports_kind ON user_imports (kind);

-- index: ix_user_imports_text (on user_imports)
CREATE INDEX ix_user_imports_text ON user_imports (text);

-- index: ix_user_imports_user (on user_imports)
CREATE INDEX ix_user_imports_user ON user_imports(user_id);

-- index: ix_user_imports_user_id (on user_imports)
CREATE INDEX ix_user_imports_user_id ON user_imports (user_id);

-- index: ix_users_username (on users)
CREATE UNIQUE INDEX ix_users_username ON users (username);

-- index: ix_wiki_pages_lesson (on wiki_pages)
CREATE INDEX ix_wiki_pages_lesson ON wiki_pages (lesson);

-- index: ix_wiki_pages_page_type (on wiki_pages)
CREATE INDEX ix_wiki_pages_page_type ON wiki_pages (page_type);

-- index: ix_wiki_pages_title (on wiki_pages)
CREATE INDEX ix_wiki_pages_title ON wiki_pages (title);

-- index: ix_wiki_pages_unit (on wiki_pages)
CREATE INDEX ix_wiki_pages_unit ON wiki_pages (unit);

-- index: ix_wiki_title (on wiki_pages)
CREATE INDEX ix_wiki_title ON wiki_pages(title);

-- index: ix_wiki_type (on wiki_pages)
CREATE INDEX ix_wiki_type ON wiki_pages(page_type);
