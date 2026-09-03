-- AiPhonix D1 migration 0003: char_image_index 改用显式 id 主键（保留 116 个认/写重字变体与原始顺序）
-- 0002 用 char 作主键导致 INSERT OR REPLACE 把「同字 .png(认)+.jpg(写)」合并成 2912 行，
-- 而旧 API 列表返回全部 3028 行。此迁移重建表：id 自增（=原数组序），char 为普通列+索引；
-- GET /:char 按 id 倒序取最后一条，对齐旧 indexMap「后者覆盖前者」语义。
DROP TABLE char_image_index;

CREATE TABLE char_image_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  pinyin TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_char_image_index_char ON char_image_index (char);
CREATE INDEX ix_char_image_index_grade ON char_image_index (grade);
CREATE INDEX ix_char_image_index_type ON char_image_index (type);