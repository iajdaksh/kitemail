-- KiteMail Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Kites table (messages)
CREATE TABLE kites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  kite_id VARCHAR(12) UNIQUE NOT NULL,  -- public ticket ID e.g. KT-X7F2M9

  -- Beloved details (who this kite is for)
  beloved_name VARCHAR(100) NOT NULL,
  beloved_nickname VARCHAR(100) NOT NULL,
  beloved_dob VARCHAR(5) NOT NULL,  -- DD/MM format

  -- Message
  message TEXT NOT NULL,

  -- Security questions (3 questions, 2 must be answered correctly)
  question_1 TEXT NOT NULL,
  answer_1 TEXT NOT NULL,
  hint_1 TEXT,

  question_2 TEXT NOT NULL,
  answer_2 TEXT NOT NULL,
  hint_2 TEXT,

  question_3 TEXT NOT NULL,
  answer_3 TEXT NOT NULL,
  hint_3 TEXT,

  -- Sender details
  sender_name VARCHAR(100),         -- null if anonymous
  sender_nickname VARCHAR(100),     -- null if anonymous
  sender_dob VARCHAR(5),            -- DD/MM, hidden from beloved
  sender_email VARCHAR(255),        -- optional, for ticket delivery
  is_anonymous BOOLEAN DEFAULT false,
  sender_ip VARCHAR(64),            -- request IP for abuse handling
  sender_user_agent TEXT,           -- browser/device fingerprinting-lite
  sender_device_id VARCHAR(64),     -- first-party cookie ID
  sender_accept_language VARCHAR(255),
  sender_referrer TEXT,

  -- Status
  status VARCHAR(20) DEFAULT 'flying',  -- flying | caught
  caught_at TIMESTAMP WITH TIME ZONE,
  
  -- Deletion tracking
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stats table (persistent counters)
CREATE TABLE stats (
  id SERIAL PRIMARY KEY,
  total_kites_flied BIGINT DEFAULT 0,
  total_kites_caught BIGINT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize stats with default values
INSERT INTO stats (id, total_kites_flied, total_kites_caught) VALUES (1, 0, 0);

-- Index for fast beloved search
CREATE INDEX idx_kites_beloved ON kites (
  LOWER(beloved_name),
  LOWER(beloved_nickname),
  beloved_dob
);

-- Index for kite_id lookup
CREATE INDEX idx_kites_kite_id ON kites (kite_id);
CREATE INDEX idx_kites_sender_ip ON kites (sender_ip);
CREATE INDEX idx_kites_sender_device_id ON kites (sender_device_id);

-- RLS Policies
ALTER TABLE kites ENABLE ROW LEVEL SECURITY;

-- Allow insert from API
CREATE POLICY "Allow insert" ON kites FOR INSERT WITH CHECK (true);

-- Allow read by kite_id (for ticket status)
CREATE POLICY "Allow read by kite_id" ON kites FOR SELECT USING (true);

-- Allow update status (when caught)
CREATE POLICY "Allow update status" ON kites FOR UPDATE USING (true);

-- Stats table policies
ALTER TABLE stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read stats" ON stats FOR SELECT USING (true);
CREATE POLICY "Allow update stats" ON stats FOR UPDATE USING (true);

-- Function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kites_updated_at
  BEFORE UPDATE ON kites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  
-- Stats trigger
CREATE TRIGGER stats_updated_at
  BEFORE UPDATE ON stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RPC Functions for incrementing stats
CREATE OR REPLACE FUNCTION increment_kites_flied()
RETURNS void AS $$
BEGIN
  UPDATE stats SET total_kites_flied = total_kites_flied + 1 WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_kites_caught()
RETURNS void AS $$
BEGIN
  UPDATE stats SET total_kites_caught = total_kites_caught + 1 WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- If your `kites` table already exists, run this migration block once:
-- ALTER TABLE kites ADD COLUMN IF NOT EXISTS sender_ip VARCHAR(64);
-- ALTER TABLE kites ADD COLUMN IF NOT EXISTS sender_user_agent TEXT;
-- ALTER TABLE kites ADD COLUMN IF NOT EXISTS sender_device_id VARCHAR(64);
-- ALTER TABLE kites ADD COLUMN IF NOT EXISTS sender_accept_language VARCHAR(255);
-- ALTER TABLE kites ADD COLUMN IF NOT EXISTS sender_referrer TEXT;
-- CREATE INDEX IF NOT EXISTS idx_kites_sender_ip ON kites (sender_ip);
-- CREATE INDEX IF NOT EXISTS idx_kites_sender_device_id ON kites (sender_device_id);
