-- AiPhonix D1 migration 0013: 课件库 courseware（语/数/英课件图片）
-- 与 upload_records 图片同目录存储（R2 data/uploads/），多模态 /ai-chat/ask 可直接消费。
CREATE TABLE courseware (
	id INTEGER NOT NULL,
	module VARCHAR(16) NOT NULL,
	file_name VARCHAR(256) NOT NULL,
	title VARCHAR(256) DEFAULT '' NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
	created_by INTEGER,
	PRIMARY KEY (id)
);
CREATE INDEX ix_courseware_module ON courseware (module);
CREATE INDEX ix_courseware_created_at ON courseware (created_at);
