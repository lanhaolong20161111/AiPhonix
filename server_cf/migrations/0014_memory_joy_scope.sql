-- AiPhonix D1 migration 0014: 记忆快乐本缓存按类型（scope）区分
-- 认字页只传今日字、练词页只传今日词，各自生成故事：
-- scope='all' 为旧混合文段（0012~0013 时期，账号+日期一条）；
-- scope='char'/'word' 为按页拆分后的文段，同账号同一天可共存两条。
ALTER TABLE memory_joy_entry ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
DROP INDEX IF EXISTS ix_memory_joy_user_date;
CREATE UNIQUE INDEX ix_memory_joy_user_date_scope ON memory_joy_entry(user_id, date, scope);
