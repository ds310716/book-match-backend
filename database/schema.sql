-- 書籍配對聊天室 - Supabase SQL Schema
-- 請在 Supabase Dashboard > SQL Editor 中執行此腳本

-- 啟用 UUID 擴充功能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 使用者表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 書籍表
CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  author VARCHAR(255) NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 聊天室表
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 聊天室參與者表（多對多關係）
CREATE TABLE IF NOT EXISTS chat_room_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(chat_room_id, user_id)
);

-- 聊天室配對書籍表
CREATE TABLE IF NOT EXISTS chat_room_books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  author VARCHAR(255) NOT NULL
);

-- 訊息表
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 創建索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(LOWER(title));
CREATE INDEX IF NOT EXISTS idx_chat_room_participants_user ON chat_room_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_participants_room ON chat_room_participants(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- 創建更新時間的觸發器函數
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 為 users 表添加更新時間觸發器
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 啟用 Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS 政策：使用者可以讀取所有使用者的公開資訊
CREATE POLICY "使用者可以查看所有使用者" ON users
  FOR SELECT USING (true);

-- RLS 政策：使用者可以更新自己的資料
CREATE POLICY "使用者可以更新自己的資料" ON users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- RLS 政策：書籍
CREATE POLICY "使用者可以查看所有書籍" ON books
  FOR SELECT USING (true);

CREATE POLICY "使用者可以新增自己的書籍" ON books
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "使用者可以刪除自己的書籍" ON books
  FOR DELETE USING (auth.uid()::text = user_id::text);

-- RLS 政策：聊天室和訊息
CREATE POLICY "參與者可以查看聊天室" ON chat_rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_room_participants
      WHERE chat_room_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "參與者可以查看訊息" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_room_participants
      WHERE chat_room_id = messages.chat_room_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "參與者可以發送訊息" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_room_participants
      WHERE chat_room_id = messages.chat_room_id AND user_id = auth.uid()
    )
  );

-- 注意：由於我們使用 Service Key 進行後端操作，RLS 政策不會影響後端 API
-- 但這些政策可以在未來直接使用 Supabase Client SDK 時提供額外的安全保障
