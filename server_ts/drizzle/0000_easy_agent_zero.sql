-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text(36) NOT NULL,
	`username` text(64) NOT NULL,
	`password_hash` text(256) NOT NULL,
	`nickname` text(64) NOT NULL,
	`role` text(16) NOT NULL,
	`grade` text(16) NOT NULL,
	`age` integer NOT NULL,
	`learning_level` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text(256) NOT NULL,
	`device_info` text(256) NOT NULL,
	`expires_at` numeric NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_refresh_tokens_user_id` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `essays` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`title` text(256) NOT NULL,
	`topic` text(256) NOT NULL,
	`audio_url` text(512) NOT NULL,
	`text_original` text NOT NULL,
	`text_ai_modified` text NOT NULL,
	`score` real NOT NULL,
	`feedback` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_essays_user_id` ON `essays` (`user_id`);--> statement-breakpoint
CREATE TABLE `speech_eval_records` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`language` text(8) NOT NULL,
	`eval_type` text(16) NOT NULL,
	`ref_text` text NOT NULL,
	`engine` text(32) NOT NULL,
	`total_accuracy` real NOT NULL,
	`total_fluency` real NOT NULL,
	`total_completion` real NOT NULL,
	`suggested_score` real NOT NULL,
	`details` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`source` text(255) DEFAULT ("")
);
--> statement-breakpoint
CREATE INDEX `ix_speech_eval_records_eval_type` ON `speech_eval_records` (`eval_type`);--> statement-breakpoint
CREATE INDEX `ix_speech_eval_records_user_id` ON `speech_eval_records` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_speech_eval_records_language` ON `speech_eval_records` (`language`);--> statement-breakpoint
CREATE INDEX `ix_speech_eval_records_created_at` ON `speech_eval_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `upload_records` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text(8) NOT NULL,
	`file_name` text(256) NOT NULL,
	`content` text NOT NULL,
	`ocr_text` text NOT NULL,
	`note` text(512) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`source` text(16) DEFAULT 'web',
	`uploader` text(64) DEFAULT '',
	`origin` text(256) DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `ix_upload_records_source` ON `upload_records` (`source`);--> statement-breakpoint
CREATE INDEX `ix_upload_records_created_at` ON `upload_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_imports` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text(16) NOT NULL,
	`text` text(256) NOT NULL,
	`pinyin` text(128) NOT NULL,
	`meaning` text(512) NOT NULL,
	`tags` text(256) NOT NULL,
	`payload` text NOT NULL,
	`status` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_user_imports_user_id` ON `user_imports` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_user_imports_kind` ON `user_imports` (`kind`);--> statement-breakpoint
CREATE INDEX `ix_user_imports_created_at` ON `user_imports` (`created_at`);--> statement-breakpoint
CREATE INDEX `ix_user_imports_text` ON `user_imports` (`text`);--> statement-breakpoint
CREATE TABLE `training_plans` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`title` text(64) NOT NULL,
	`items_json` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_training_plans_user_id` ON `training_plans` (`user_id`);--> statement-breakpoint
CREATE TABLE `practice_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`plan_item_id` text(64) NOT NULL,
	`feature` text(32) NOT NULL,
	`date` text(10) NOT NULL,
	`status` text(16) NOT NULL,
	`count` integer NOT NULL,
	`correct` integer,
	`score` real,
	`duration_ms` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_practice_sessions_user_id` ON `practice_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_practice_sessions_feature` ON `practice_sessions` (`feature`);--> statement-breakpoint
CREATE INDEX `ix_practice_sessions_date` ON `practice_sessions` (`date`);--> statement-breakpoint
CREATE INDEX `ix_practice_sessions_plan_item_id` ON `practice_sessions` (`plan_item_id`);--> statement-breakpoint
CREATE TABLE `ai_practice_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`content_type` text(16) NOT NULL,
	`content` text NOT NULL,
	`task` text(32) NOT NULL,
	`plan_json` text NOT NULL,
	`status` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_ai_practice_sessions_user_id` ON `ai_practice_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_ai_practice_sessions_status` ON `ai_practice_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `ai_practice_turns` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` integer NOT NULL,
	`role` text(8) NOT NULL,
	`text` text NOT NULL,
	`correction` text NOT NULL,
	`praise` text NOT NULL,
	`audio_path` text(256) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_ai_practice_turns_session_id` ON `ai_practice_turns` (`session_id`);--> statement-breakpoint
CREATE TABLE `question_templates` (
	`id` integer PRIMARY KEY NOT NULL,
	`signature` text(128) NOT NULL,
	`question_type` text(64) NOT NULL,
	`type_hint` text NOT NULL,
	`sample_question` text NOT NULL,
	`hit_count` integer NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`source` text(8) DEFAULT 'llm'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_question_templates_signature` ON `question_templates` (`signature`);--> statement-breakpoint
CREATE TABLE `char_click_stats` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`char` text(8) NOT NULL,
	`click_count` integer NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_char_click_stats_user_id` ON `char_click_stats` (`user_id`);--> statement-breakpoint
CREATE TABLE `quest_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`question` text NOT NULL,
	`plan_json` text NOT NULL,
	`history_json` text NOT NULL,
	`step_index` integer NOT NULL,
	`status` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`sub_json` text DEFAULT '',
	`sub_level` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `ix_quest_sessions_user_id` ON `quest_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `chinese_unit_knowledge` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit` text(32) NOT NULL,
	`lesson` text(64) NOT NULL,
	`category` text(32) NOT NULL,
	`page` text(16) NOT NULL,
	`content` text NOT NULL,
	`knowledge_points` text NOT NULL,
	`question_types` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`image_path` text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_unit_knowledge_category` ON `chinese_unit_knowledge` (`category`);--> statement-breakpoint
CREATE INDEX `ix_chinese_unit_knowledge_lesson` ON `chinese_unit_knowledge` (`lesson`);--> statement-breakpoint
CREATE INDEX `ix_chinese_unit_knowledge_unit` ON `chinese_unit_knowledge` (`unit`);--> statement-breakpoint
CREATE TABLE `chinese_reading_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit` text(32) NOT NULL,
	`lesson` text(64) NOT NULL,
	`category` text(32) NOT NULL,
	`page` text(16) NOT NULL,
	`passage` text NOT NULL,
	`question` text NOT NULL,
	`question_type` text(32) NOT NULL,
	`answer` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_reading_items_lesson` ON `chinese_reading_items` (`lesson`);--> statement-breakpoint
CREATE INDEX `ix_chinese_reading_items_unit` ON `chinese_reading_items` (`unit`);--> statement-breakpoint
CREATE INDEX `ix_chinese_reading_items_question_type` ON `chinese_reading_items` (`question_type`);--> statement-breakpoint
CREATE TABLE `chinese_question_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`category` text(32) NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`unit` text(32) NOT NULL,
	`lesson` text(64) NOT NULL,
	`page` text(16) NOT NULL,
	`source` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_question_items_unit` ON `chinese_question_items` (`unit`);--> statement-breakpoint
CREATE INDEX `ix_chinese_question_items_category` ON `chinese_question_items` (`category`);--> statement-breakpoint
CREATE INDEX `ix_chinese_question_items_lesson` ON `chinese_question_items` (`lesson`);--> statement-breakpoint
CREATE INDEX `ix_chinese_question_items_source` ON `chinese_question_items` (`source`);--> statement-breakpoint
CREATE TABLE `chinese_essay_knowledge` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit` text(32) NOT NULL,
	`title` text(64) NOT NULL,
	`topic` text(128) NOT NULL,
	`requirement` text NOT NULL,
	`guide` text NOT NULL,
	`goals` text NOT NULL,
	`page` text(16) NOT NULL,
	`content` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`model_essay` text DEFAULT '',
	`good_words` text DEFAULT '',
	`image_path` text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_essay_knowledge_title` ON `chinese_essay_knowledge` (`title`);--> statement-breakpoint
CREATE INDEX `ix_chinese_essay_knowledge_unit` ON `chinese_essay_knowledge` (`unit`);--> statement-breakpoint
CREATE TABLE `chinese_textbook_pages` (
	`id` integer PRIMARY KEY NOT NULL,
	`page` text(16) NOT NULL,
	`unit` text(32) NOT NULL,
	`lesson` text(64) NOT NULL,
	`page_type` text(32) NOT NULL,
	`content` text NOT NULL,
	`knowledge_points` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`image_path` text DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_textbook_pages_lesson` ON `chinese_textbook_pages` (`lesson`);--> statement-breakpoint
CREATE INDEX `ix_chinese_textbook_pages_page_type` ON `chinese_textbook_pages` (`page_type`);--> statement-breakpoint
CREATE INDEX `ix_chinese_textbook_pages_page` ON `chinese_textbook_pages` (`page`);--> statement-breakpoint
CREATE INDEX `ix_chinese_textbook_pages_unit` ON `chinese_textbook_pages` (`unit`);--> statement-breakpoint
CREATE TABLE `wiki_pages` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text(128) NOT NULL,
	`page_type` text(16) NOT NULL,
	`content` text NOT NULL,
	`unit` text(32) NOT NULL,
	`lesson` text(64) NOT NULL,
	`source_ref` text NOT NULL,
	`links` text NOT NULL,
	`status` text(16) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_wiki_pages_page_type` ON `wiki_pages` (`page_type`);--> statement-breakpoint
CREATE INDEX `ix_wiki_pages_unit` ON `wiki_pages` (`unit`);--> statement-breakpoint
CREATE INDEX `ix_wiki_pages_lesson` ON `wiki_pages` (`lesson`);--> statement-breakpoint
CREATE INDEX `ix_wiki_pages_title` ON `wiki_pages` (`title`);--> statement-breakpoint
CREATE TABLE `knowledge_relations` (
	`id` integer PRIMARY KEY NOT NULL,
	`from_id` integer NOT NULL,
	`relation` text(24) NOT NULL,
	`to_id` integer NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_knowledge_relations_to_id` ON `knowledge_relations` (`to_id`);--> statement-breakpoint
CREATE INDEX `ix_knowledge_relations_from_id` ON `knowledge_relations` (`from_id`);--> statement-breakpoint
CREATE INDEX `ix_knowledge_relations_relation` ON `knowledge_relations` (`relation`);--> statement-breakpoint
CREATE TABLE `chinese_fts` (
	`content` numeric,
	`src_type` numeric,
	`src_id` numeric,
	`chinese_fts` numeric,
	`rank` numeric
);
--> statement-breakpoint
CREATE TABLE `chinese_fts_data` (
	`id` integer PRIMARY KEY,
	`block` blob
);
--> statement-breakpoint
CREATE TABLE `chinese_fts_idx` (
	`segid` numeric NOT NULL,
	`term` numeric NOT NULL,
	`pgno` numeric,
	PRIMARY KEY(`segid`, `term`)
);
--> statement-breakpoint
CREATE TABLE `chinese_fts_content` (
	`id` integer PRIMARY KEY,
	`c0` numeric,
	`c1` numeric,
	`c2` numeric
);
--> statement-breakpoint
CREATE TABLE `chinese_fts_docsize` (
	`id` integer PRIMARY KEY,
	`sz` blob
);
--> statement-breakpoint
CREATE TABLE `chinese_fts_config` (
	`k` numeric PRIMARY KEY NOT NULL,
	`v` numeric
);
--> statement-breakpoint
CREATE TABLE `chinese_recitation_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit` text(32) NOT NULL,
	`title` text(64) NOT NULL,
	`author` text(32) NOT NULL,
	`kind` text(16) NOT NULL,
	`content` text NOT NULL,
	`source_ref` text(64) NOT NULL,
	`page` text(16) NOT NULL,
	`image_path` text(256) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_chinese_recitation_items_title` ON `chinese_recitation_items` (`title`);--> statement-breakpoint
CREATE INDEX `ix_chinese_recitation_items_kind` ON `chinese_recitation_items` (`kind`);--> statement-breakpoint
CREATE INDEX `ix_chinese_recitation_items_unit` ON `chinese_recitation_items` (`unit`);--> statement-breakpoint
CREATE TABLE `char_unknown_marks` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`char` text(8) NOT NULL,
	`lesson` text(64) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_char_unknown_marks_user_id` ON `char_unknown_marks` (`user_id`);--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`module` text(16) NOT NULL,
	`session_count` integer NOT NULL,
	`last_content` text NOT NULL,
	`mistakes` text NOT NULL,
	`mastered` text NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_student_profiles_user_id` ON `student_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `ai_chat_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` text(64) NOT NULL,
	`user_id` integer NOT NULL,
	`module` text(16) NOT NULL,
	`messages` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_ai_chat_sessions_user_id` ON `ai_chat_sessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ix_ai_chat_sessions_session_id` ON `ai_chat_sessions` (`session_id`);
*/