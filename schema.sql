-- Lobster Wars Database Schema
-- Run this in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/banjuonrhsfrfbudwelf/sql/new

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'New Lobsterman',
  cash INTEGER NOT NULL DEFAULT 500,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  boat_type TEXT NOT NULL DEFAULT 'starter',
  upgrades JSONB NOT NULL DEFAULT '{"boatLevel":1,"trapLevel":1,"baitLevel":1,"holdLevel":1,"maxTraps":10}'::jsonb,
  inventory JSONB NOT NULL DEFAULT '{"bait":10,"trapSupply":5,"hold":[]}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{"totalCatch":0,"totalEarnings":0,"biggestLobster":0,"trapsHauled":0,"daysPlayed":0}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Territories table
CREATE TABLE IF NOT EXISTS territories (
  id SERIAL PRIMARY KEY,
  zone_name TEXT NOT NULL UNIQUE,
  zone_bounds JSONB NOT NULL,
  owner_id UUID REFERENCES players(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  contested_by UUID REFERENCES players(id) ON DELETE SET NULL,
  contest_started_at TIMESTAMPTZ,
  contest_scores JSONB DEFAULT '{}'::jsonb
);

-- Leaderboard table
CREATE TABLE IF NOT EXISTS leaderboard (
  id SERIAL PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, category)
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Players are viewable by everyone" ON players;
CREATE POLICY "Players are viewable by everyone" ON players FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can update own player" ON players;
CREATE POLICY "Users can update own player" ON players FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own player" ON players;
CREATE POLICY "Users can insert own player" ON players FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Territories viewable by everyone" ON territories;
CREATE POLICY "Territories viewable by everyone" ON territories FOR SELECT USING (true);
DROP POLICY IF EXISTS "Leaderboard viewable by everyone" ON leaderboard;
CREATE POLICY "Leaderboard viewable by everyone" ON leaderboard FOR SELECT USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_category ON leaderboard(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);

-- Default territory zones
INSERT INTO territories (zone_name, zone_bounds) VALUES
  ('The Shallows', '{"x":0,"y":0,"w":40,"h":40,"color":"rgba(39,174,96,0.15)"}'),
  ('Deep Waters', '{"x":60,"y":0,"w":60,"h":60,"color":"rgba(41,128,185,0.15)"}'),
  ('Rocky Reef', '{"x":0,"y":60,"w":40,"h":60,"color":"rgba(142,68,173,0.15)"}'),
  ('The Trench', '{"x":40,"y":40,"w":40,"h":40,"color":"rgba(192,57,43,0.15)"}'),
  ('Foggy Banks', '{"x":80,"y":60,"w":40,"h":60,"color":"rgba(243,156,18,0.15)"}'),
  ('Lobster Alley', '{"x":40,"y":80,"w":40,"h":40,"color":"rgba(26,188,156,0.15)"}')
ON CONFLICT (zone_name) DO NOTHING;
