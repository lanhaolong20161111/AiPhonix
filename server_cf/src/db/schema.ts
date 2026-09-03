import { sqliteTable, AnySQLiteColumn, uniqueIndex, integer, numeric, index, text, real, blob, primaryKey } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const users = sqliteTable("users", {
	id: integer().primaryKey().notNull(),
	uuid: text({ length: 36 }).notNull(),
	username: text({ length: 64 }).notNull(),
	passwordHash: text("password_hash", { length: 256 }).notNull(),
	nickname: text({ length: 64 }).notNull(),
	role: text({ length: 16 }).notNull(),
	grade: text({ length: 16 }).notNull(),
	age: integer().notNull(),
	learningLevel: text("learning_level", { length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_users_username").on(table.username),
]);

export const refreshTokens = sqliteTable("refresh_tokens", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	tokenHash: text("token_hash", { length: 256 }).notNull(),
	deviceInfo: text("device_info", { length: 256 }).notNull(),
	expiresAt: numeric("expires_at").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_refresh_tokens_user_id").on(table.userId),
]);

export const essays = sqliteTable("essays", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	title: text({ length: 256 }).notNull(),
	topic: text({ length: 256 }).notNull(),
	audioUrl: text("audio_url", { length: 512 }).notNull(),
	textOriginal: text("text_original").notNull(),
	textAiModified: text("text_ai_modified").notNull(),
	score: real().notNull(),
	feedback: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_essays_user_id").on(table.userId),
]);

export const speechEvalRecords = sqliteTable("speech_eval_records", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	language: text({ length: 8 }).notNull(),
	evalType: text("eval_type", { length: 16 }).notNull(),
	refText: text("ref_text").notNull(),
	engine: text({ length: 32 }).notNull(),
	totalAccuracy: real("total_accuracy").notNull(),
	totalFluency: real("total_fluency").notNull(),
	totalCompletion: real("total_completion").notNull(),
	suggestedScore: real("suggested_score").notNull(),
	details: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	source: text({ length: 255 }).default(""),
},
(table) => [
	index("ix_speech_eval_records_eval_type").on(table.evalType),
	index("ix_speech_eval_records_user_id").on(table.userId),
	index("ix_speech_eval_records_language").on(table.language),
	index("ix_speech_eval_records_created_at").on(table.createdAt),
]);

export const uploadRecords = sqliteTable("upload_records", {
	id: integer().primaryKey().notNull(),
	kind: text({ length: 8 }).notNull(),
	fileName: text("file_name", { length: 256 }).notNull(),
	content: text().notNull(),
	ocrText: text("ocr_text").notNull(),
	note: text({ length: 512 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	source: text({ length: 16 }).default("web"),
	uploader: text({ length: 64 }).default(""),
	origin: text({ length: 256 }).default(""),
},
(table) => [
	index("ix_upload_records_source").on(table.source),
	index("ix_upload_records_created_at").on(table.createdAt),
]);

export const userImports = sqliteTable("user_imports", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	kind: text({ length: 16 }).notNull(),
	text: text({ length: 256 }).notNull(),
	pinyin: text({ length: 128 }).notNull(),
	meaning: text({ length: 512 }).notNull(),
	tags: text({ length: 256 }).notNull(),
	payload: text().notNull(),
	status: text({ length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_user_imports_user_id").on(table.userId),
	index("ix_user_imports_kind").on(table.kind),
	index("ix_user_imports_created_at").on(table.createdAt),
	index("ix_user_imports_text").on(table.text),
]);

export const trainingPlans = sqliteTable("training_plans", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	title: text({ length: 64 }).notNull(),
	itemsJson: text("items_json").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_training_plans_user_id").on(table.userId),
]);

export const practiceSessions = sqliteTable("practice_sessions", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	planItemId: text("plan_item_id", { length: 64 }).notNull(),
	feature: text({ length: 32 }).notNull(),
	date: text({ length: 10 }).notNull(),
	status: text({ length: 16 }).notNull(),
	count: integer().notNull(),
	correct: integer(),
	score: real(),
	durationMs: integer("duration_ms").notNull(),
	metricsJson: text("metrics_json").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_practice_sessions_user_id").on(table.userId),
	index("ix_practice_sessions_feature").on(table.feature),
	index("ix_practice_sessions_date").on(table.date),
	index("ix_practice_sessions_plan_item_id").on(table.planItemId),
]);

export const visitCounts = sqliteTable("visit_counts", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	route: text({ length: 256 }).notNull(),
	count: integer().notNull().default(0),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_visit_counts_user_route").on(table.userId, table.route),
]);

/** 用户偏好（音色/角色/助记词等，整包 JSON 存，按账户隔离、跨设备同步）。
 * 对齐 server_ts；CF 端表运行时幂等自建（见 routes/prefs.ts ensureTable）。 */
export const userPrefs = sqliteTable("user_prefs", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").notNull(),
	prefs: text().notNull().default("{}"),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_user_prefs_user_id").on(table.userId),
])

export const aiPracticeSessions = sqliteTable("ai_practice_sessions", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	contentType: text("content_type", { length: 16 }).notNull(),
	content: text().notNull(),
	task: text({ length: 32 }).notNull(),
	planJson: text("plan_json").notNull(),
	status: text({ length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_ai_practice_sessions_user_id").on(table.userId),
	index("ix_ai_practice_sessions_status").on(table.status),
]);

export const aiPracticeTurns = sqliteTable("ai_practice_turns", {
	id: integer().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	role: text({ length: 8 }).notNull(),
	text: text().notNull(),
	correction: text().notNull(),
	praise: text().notNull(),
	audioPath: text("audio_path", { length: 256 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_ai_practice_turns_session_id").on(table.sessionId),
]);

export const questionTemplates = sqliteTable("question_templates", {
	id: integer().primaryKey().notNull(),
	signature: text({ length: 128 }).notNull(),
	questionType: text("question_type", { length: 64 }).notNull(),
	typeHint: text("type_hint").notNull(),
	sampleQuestion: text("sample_question").notNull(),
	hitCount: integer("hit_count").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	source: text({ length: 8 }).default("llm"),
},
(table) => [
	uniqueIndex("ix_question_templates_signature").on(table.signature),
]);

export const charClickStats = sqliteTable("char_click_stats", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	char: text({ length: 8 }).notNull(),
	clickCount: integer("click_count").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_char_click_stats_user_id").on(table.userId),
]);

export const questSessions = sqliteTable("quest_sessions", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	question: text().notNull(),
	planJson: text("plan_json").notNull(),
	historyJson: text("history_json").notNull(),
	stepIndex: integer("step_index").notNull(),
	status: text({ length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	subJson: text("sub_json").default(""),
	subLevel: integer("sub_level").default(0),
},
(table) => [
	index("ix_quest_sessions_user_id").on(table.userId),
]);

export const chineseUnitKnowledge = sqliteTable("chinese_unit_knowledge", {
	id: integer().primaryKey().notNull(),
	unit: text({ length: 32 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	category: text({ length: 32 }).notNull(),
	page: text({ length: 16 }).notNull(),
	content: text().notNull(),
	knowledgePoints: text("knowledge_points").notNull(),
	questionTypes: text("question_types").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	imagePath: text("image_path").default(""),
},
(table) => [
	index("ix_chinese_unit_knowledge_category").on(table.category),
	index("ix_chinese_unit_knowledge_lesson").on(table.lesson),
	index("ix_chinese_unit_knowledge_unit").on(table.unit),
]);

export const chineseReadingItems = sqliteTable("chinese_reading_items", {
	id: integer().primaryKey().notNull(),
	unit: text({ length: 32 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	category: text({ length: 32 }).notNull(),
	page: text({ length: 16 }).notNull(),
	passage: text().notNull(),
	question: text().notNull(),
	questionType: text("question_type", { length: 32 }).notNull(),
	answer: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_chinese_reading_items_lesson").on(table.lesson),
	index("ix_chinese_reading_items_unit").on(table.unit),
	index("ix_chinese_reading_items_question_type").on(table.questionType),
]);

export const chineseQuestionItems = sqliteTable("chinese_question_items", {
	id: integer().primaryKey().notNull(),
	category: text({ length: 32 }).notNull(),
	question: text().notNull(),
	answer: text().notNull(),
	unit: text({ length: 32 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	page: text({ length: 16 }).notNull(),
	source: text({ length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_chinese_question_items_unit").on(table.unit),
	index("ix_chinese_question_items_category").on(table.category),
	index("ix_chinese_question_items_lesson").on(table.lesson),
	index("ix_chinese_question_items_source").on(table.source),
]);

export const chineseEssayKnowledge = sqliteTable("chinese_essay_knowledge", {
	id: integer().primaryKey().notNull(),
	unit: text({ length: 32 }).notNull(),
	title: text({ length: 64 }).notNull(),
	topic: text({ length: 128 }).notNull(),
	requirement: text().notNull(),
	guide: text().notNull(),
	goals: text().notNull(),
	page: text({ length: 16 }).notNull(),
	content: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	modelEssay: text("model_essay").default(""),
	goodWords: text("good_words").default(""),
	imagePath: text("image_path").default(""),
},
(table) => [
	index("ix_chinese_essay_knowledge_title").on(table.title),
	index("ix_chinese_essay_knowledge_unit").on(table.unit),
]);

export const chineseTextbookPages = sqliteTable("chinese_textbook_pages", {
	id: integer().primaryKey().notNull(),
	page: text({ length: 16 }).notNull(),
	unit: text({ length: 32 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	pageType: text("page_type", { length: 32 }).notNull(),
	content: text().notNull(),
	knowledgePoints: text("knowledge_points").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	imagePath: text("image_path").default(""),
},
(table) => [
	index("ix_chinese_textbook_pages_lesson").on(table.lesson),
	index("ix_chinese_textbook_pages_page_type").on(table.pageType),
	index("ix_chinese_textbook_pages_page").on(table.page),
	index("ix_chinese_textbook_pages_unit").on(table.unit),
]);

export const wikiPages = sqliteTable("wiki_pages", {
	id: integer().primaryKey().notNull(),
	title: text({ length: 128 }).notNull(),
	pageType: text("page_type", { length: 16 }).notNull(),
	content: text().notNull(),
	unit: text({ length: 32 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	sourceRef: text("source_ref").notNull(),
	links: text().notNull(),
	status: text({ length: 16 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_wiki_pages_page_type").on(table.pageType),
	index("ix_wiki_pages_unit").on(table.unit),
	index("ix_wiki_pages_lesson").on(table.lesson),
	index("ix_wiki_pages_title").on(table.title),
]);

export const knowledgeRelations = sqliteTable("knowledge_relations", {
	id: integer().primaryKey().notNull(),
	fromId: integer("from_id").notNull(),
	relation: text({ length: 24 }).notNull(),
	toId: integer("to_id").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_knowledge_relations_to_id").on(table.toId),
	index("ix_knowledge_relations_from_id").on(table.fromId),
	index("ix_knowledge_relations_relation").on(table.relation),
]);

export const chineseFts = sqliteTable("chinese_fts", {
	content: numeric(),
	srcType: numeric("src_type"),
	srcId: numeric("src_id"),
	chineseFts: numeric("chinese_fts"),
	rank: numeric(),
});

export const chineseFtsData = sqliteTable("chinese_fts_data", {
	id: integer().primaryKey(),
	block: blob(),
});

export const chineseFtsIdx = sqliteTable("chinese_fts_idx", {
	segid: numeric().notNull(),
	term: numeric().notNull(),
	pgno: numeric(),
},
(table) => [
	primaryKey({ columns: [table.segid, table.term], name: "chinese_fts_idx_segid_term_pk"})
]);

export const chineseFtsContent = sqliteTable("chinese_fts_content", {
	id: integer().primaryKey(),
	c0: numeric(),
	c1: numeric(),
	c2: numeric(),
});

export const chineseFtsDocsize = sqliteTable("chinese_fts_docsize", {
	id: integer().primaryKey(),
	sz: blob(),
});

export const chineseFtsConfig = sqliteTable("chinese_fts_config", {
	k: numeric().primaryKey().notNull(),
	v: numeric(),
});

export const chineseRecitationItems = sqliteTable("chinese_recitation_items", {
	id: integer().primaryKey().notNull(),
	unit: text({ length: 32 }).notNull(),
	title: text({ length: 64 }).notNull(),
	author: text({ length: 32 }).notNull(),
	kind: text({ length: 16 }).notNull(),
	content: text().notNull(),
	sourceRef: text("source_ref", { length: 64 }).notNull(),
	page: text({ length: 16 }).notNull(),
	imagePath: text("image_path", { length: 256 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_chinese_recitation_items_title").on(table.title),
	index("ix_chinese_recitation_items_kind").on(table.kind),
	index("ix_chinese_recitation_items_unit").on(table.unit),
]);

export const charUnknownMarks = sqliteTable("char_unknown_marks", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	char: text({ length: 8 }).notNull(),
	lesson: text({ length: 64 }).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_char_unknown_marks_user_id").on(table.userId),
]);

export const studentProfiles = sqliteTable("student_profiles", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	module: text({ length: 16 }).notNull(),
	sessionCount: integer("session_count").notNull(),
	lastContent: text("last_content").notNull(),
	mistakes: text().notNull(),
	mastered: text().notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_student_profiles_user_id").on(table.userId),
]);

export const aiChatSessions = sqliteTable("ai_chat_sessions", {
	id: integer().primaryKey().notNull(),
	sessionId: text("session_id", { length: 64 }).notNull(),
	userId: integer("user_id").notNull(),
	module: text({ length: 16 }).notNull(),
	messages: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("ix_ai_chat_sessions_user_id").on(table.userId),
	uniqueIndex("ix_ai_chat_sessions_session_id").on(table.sessionId),
]);


// ── 2026-08-27：共享状态 JSON 文件迁 SQLite（根治双后端脑裂；单写方为 TS）──

/** 复习权重记录（原 server_py/data/char_practice.json）。
 * id 自增保持插入序（对齐 PY records.values() 列表顺序语义）；last_seen 为 unix 浮点秒。 */
export const charPractice = sqliteTable("char_practice", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").notNull(),
	char: text().notNull(),
	pinyinCorrect: integer("pinyin_correct").notNull().default(0),
	pinyinWrong: integer("pinyin_wrong").notNull().default(0),
	pronunciationCorrect: integer("pronunciation_correct").notNull().default(0),
	pronunciationWrong: integer("pronunciation_wrong").notNull().default(0),
	consecutiveCorrect: integer("consecutive_correct").notNull().default(0),
	lastSeen: real("last_seen"),
	lastCorrect: integer("last_correct", { mode: "boolean" }).notNull().default(false),
	passed: integer("passed", { mode: "boolean" }).notNull().default(false),
},
(table) => [
	uniqueIndex("ix_char_practice_user_char").on(table.userId, table.char),
	index("ix_char_practice_user").on(table.userId),
]);

/** LLM 日累计预算（原 llm_budget.json，按日期一行） */
export const llmBudgetDay = sqliteTable("llm_budget_day", {
	date: text().primaryKey(),
	totalCost: real("total_cost").notNull().default(0),
	calls: integer().notNull().default(0),
});

/** LLM 调用日志（原 llm_call_logs.json 数组 → 行式追加，消除全量重写放大） */
export const llmCallLog = sqliteTable("llm_call_log", {
	id: integer().primaryKey({ autoIncrement: true }),
	time: text().notNull(),
	caller: text().notNull().default(""),
	model: text().notNull().default(""),
	systemPrompt: text("system_prompt").notNull().default(""),
	userPrompt: text("user_prompt").notNull().default(""),
	promptTokens: integer("prompt_tokens").notNull().default(0),
	compTokens: integer("comp_tokens").notNull().default(0),
	totalTokens: integer("total_tokens").notNull().default(0),
	costYuan: real("cost_yuan").notNull().default(0),
	durationMs: integer("duration_ms").notNull().default(0),
	success: integer("success", { mode: "boolean" }).notNull().default(false),
	error: text().notNull().default(""),
});

// ── 2026-08-28：认字索引/反馈 + 词库 JSON 文件迁 D1（消读改写竞态，migrations/0002）──

/** 认字索引（原 data/char_image_index.json；extra 保留未建模字段）。
 * id 自增 = 原数组序（migrations/0003）；同字存在 认(.png)/写(.jpg) 变体，char 非唯一。 */
export const charImageIndex = sqliteTable("char_image_index", {
	id: integer().primaryKey({ autoIncrement: true }),
	char: text().notNull(),
	grade: text().notNull().default(""),
	semester: text().notNull().default(""),
	type: text().notNull().default(""),
	image: text().notNull().default(""),
	pinyin: text().notNull().default(""),
	extra: text().notNull().default("{}"),
},
(table) => [
	index("ix_char_image_index_char").on(table.char),
	index("ix_char_image_index_grade").on(table.grade),
	index("ix_char_image_index_type").on(table.type),
]);

/** 认字反馈（原 data/char_image_feedback.json；UPSERT 原子化） */
export const charImageFeedback = sqliteTable("char_image_feedback", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").notNull().default(0),
	char: text().notNull(),
	grade: text().notNull().default(""),
	semester: text().notNull().default(""),
	type: text().notNull().default(""),
	learningStatus: text("learning_status"),
	needsRegen: integer("needs_regen", { mode: "boolean" }).notNull().default(false),
	timestamp: text().notNull().default(""),
	extra: text().notNull().default("{}"),
},
(table) => [
	uniqueIndex("uq_char_image_feedback_scope").on(table.userId, table.char, table.grade, table.semester, table.type),
	index("ix_char_image_feedback_user").on(table.userId),
	index("ix_char_image_feedback_char").on(table.char),
]);

/** 词库条目（原 data/wordbank.json 的 chars/words 数组合一；json 列整体保存原条目） */
export const wordbankItem = sqliteTable("wordbank_item", {
	text: text().primaryKey().notNull(),
	kind: text().notNull().default("chars"),
	json: text().notNull().default("{}"),
},
(table) => [
	index("ix_wordbank_item_kind").on(table.kind),
]);

// ── 2026-08-28：可观测性（🟡8）——请求/错误日志（migrations/0004）──

export const requestLogs = sqliteTable("request_logs", {
	id: integer().primaryKey({ autoIncrement: true }),
	ts: text().notNull(),
	method: text().notNull().default(""),
	path: text().notNull().default(""),
	status: integer().notNull().default(0),
	durationMs: integer("duration_ms").notNull().default(0),
	level: text().notNull().default("info"),
	message: text().notNull().default(""),
	meta: text().notNull().default("{}"),
},
(table) => [
	index("ix_request_logs_ts").on(table.ts),
	index("ix_request_logs_status").on(table.status),
	index("ix_request_logs_path").on(table.path),
]);

// ── 2026-08-29：生词本（间隔重复 SRS）──

export const wordbookItem = sqliteTable("wordbook_item", {
	id: integer().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	text: text({ length: 64 }).notNull(),
	pinyin: text({ length: 128 }).default("").notNull(),
	source: text({ length: 32 }).default("chat").notNull(),
	times: integer().default(0).notNull(),
	correct: integer().default(0).notNull(),
	box: integer().default(1).notNull(),
	nextReview: text("next_review").default("").notNull(),
	createdAt: text("created_at").default("").notNull(),
	updatedAt: text("updated_at").default("").notNull(),
},
(table) => [
	uniqueIndex("ix_wordbook_user_text").on(table.userId, table.text),
	index("ix_wordbook_user_next").on(table.userId, table.nextReview),
]);

// ── 2026-08-30：偏旁魔法屋 LLM 内容缓存（儿歌/字谜，每字族生成一次）──

export const radicalContent = sqliteTable("radical_content", {
	id: integer().primaryKey().notNull(),
	family: text({ length: 16 }).notNull(),
	kind: text({ length: 16 }).notNull(),
	content: text().notNull(),
	createdAt: text("created_at").default("").notNull(),
},
(table) => [
	uniqueIndex("ix_radical_content_family_kind").on(table.family, table.kind),
]);

// ── 2026-08-31：每日一练·语文今日字词句作文配置（按账号+日期，跨设备同步）──

export const dailyZhConfig = sqliteTable("daily_zh_config", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").notNull(),
	date: text().notNull(),
	chars: text().notNull().default(""),
	words: text().notNull().default(""),
	sentences: text().notNull().default(""),
	essayTopic: text("essay_topic").notNull().default(""),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_daily_zh_user_date").on(table.userId, table.date),
	index("ix_daily_zh_user").on(table.userId),
]);

// ── 2026-09-02：每日一练·英语今日单词/句子配置 + LLM 内容缓存（镜像 daily_zh / radical_content）──

export const dailyEnConfig = sqliteTable("daily_en_config", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").notNull(),
	date: text().notNull(),
	words: text().notNull().default(""),
	sentences: text().notNull().default(""),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	uniqueIndex("ix_daily_en_user_date").on(table.userId, table.date),
	index("ix_daily_en_user").on(table.userId),
]);

export const dailyEnContent = sqliteTable("daily_en_content", {
	id: integer().primaryKey({ autoIncrement: true }),
	kind: text({ length: 16 }).notNull(), // 'word' | 'sentence'
	text: text().notNull(), // 小写规范化后的原词/原句
	content: text().notNull().default("{}"),
	createdAt: text("created_at").default("").notNull(),
},
(table) => [
	uniqueIndex("ix_daily_en_content_kind_text").on(table.kind, table.text),
]);

// 英文图片索引（按 单词/句子 精确匹配；数据库里没有就不显示图片）
export const englishImageIndex = sqliteTable("english_image_index", {
	id: integer().primaryKey({ autoIncrement: true }),
	kind: text({ length: 16 }).notNull().default("word"), // 'word' | 'sentence'
	text: text().notNull(), // 小写规范化后的原词/原句
	image: text().notNull().default(""),
	extra: text().notNull().default("{}"),
},
(table) => [
	uniqueIndex("ix_english_image_index_kind_text").on(table.kind, table.text),
]);
