-- AiPhonix D1 migration 0010: char_practice 加 passed 列（认字"已通过"持久化）
-- 认字页整字全部关卡达标（isCorrect=true）后置 1，选字宫格跨会话标绿。
ALTER TABLE char_practice ADD COLUMN passed INTEGER NOT NULL DEFAULT 0;
