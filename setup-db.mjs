// Setup database schema for Lobster Wars
// Run once: node setup-db.mjs

const SUPABASE_URL = 'https://banjuonrhsfrfbudwelf.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Use the Supabase SQL endpoint via REST
async function runSQL(sql) {
  // Use the pg_query RPC or direct SQL execution
  // Actually, Supabase doesn't have a direct SQL endpoint via REST.
  // We'll use the supabase-js client to call rpc or use fetch to the management API.
  // Simplest: use fetch to POST to the Supabase REST API with raw SQL via rpc.
  
  // Let's try using the supabase-js client
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  // Execute SQL by calling a custom function, or we can create tables via the API
  // Actually the best approach: use fetch directly to the Supabase SQL HTTP API
  // which is at /rest/v1/rpc but we need a function for that.
  
  // Alternative: Use the Supabase Management API (requires project ref + service key)
  // POST https://<project-ref>.supabase.co/rest/v1/rpc/exec_sql won't work out of the box
  
  // Let's use the Supabase client's from() to check if tables exist, and if not,
  // we'll POST raw SQL to the pg endpoint
  
  // Actually, the Supabase HTTP API for raw SQL is:
  // POST https://<ref>.supabase.co/pg/query  (newer versions)
  // or we can use the management API at https://api.supabase.com
  
  // Simplest approach that works: use fetch to the query endpoint
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  return res;
}

async function setup() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Try creating tables using raw SQL via the query endpoint
  const sql = `
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
  zone_name TEXT NOT NULL,
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

-- Players: users can read all, update own
CREATE POLICY IF NOT EXISTS "Players are viewable by everyone" ON players FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Users can update own player" ON players FOR UPDATE USING (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Users can insert own player" ON players FOR INSERT WITH CHECK (auth.uid() = id);

-- Territories: readable by all
CREATE POLICY IF NOT EXISTS "Territories viewable by everyone" ON territories FOR SELECT USING (true);

-- Leaderboard: readable by all
CREATE POLICY IF NOT EXISTS "Leaderboard viewable by everyone" ON leaderboard FOR SELECT USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_category ON leaderboard(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
`;

  // Execute via Supabase's rpc - we need to create a helper function first
  // or use the direct pg endpoint. Let's try the pg/query endpoint.
  
  console.log('Attempting to create tables via Supabase SQL...');
  
  // Try the /pg/query endpoint (available in newer Supabase)
  let res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  if (res.ok) {
    console.log('✅ Tables created successfully via /pg/query');
    const data = await res.json();
    console.log(data);
  } else {
    console.log(`/pg/query returned ${res.status}, trying alternative...`);
    
    // Alternative: split and run individual statements via rpc
    // Or use the Supabase Management API
    // Let's try posting to the SQL editor API
    const projectRef = 'banjuonrhsfrfbudwelf';
    
    // Try the management API
    res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    
    if (res.ok) {
      console.log('✅ Tables created via management API');
    } else {
      console.log(`Management API returned ${res.status}`);
      const text = await res.text();
      console.log(text);
      
      console.log('\n⚠️  Automatic SQL execution failed.');
      console.log('Please run the following SQL manually in the Supabase Dashboard SQL Editor:');
      console.log('Go to: https://supabase.com/dashboard/project/banjuonrhsfrfbudwelf/sql/new');
      console.log('\n--- SQL START ---');
      console.log(sql);
      console.log('--- SQL END ---');
    }
  }

  // Insert default territory zones regardless
  console.log('\nInserting default territory zones...');
  
  const territories = [
    { zone_name: 'The Shallows', zone_bounds: { x: 0, y: 0, w: 40, h: 40, color: '#27ae6040' } },
    { zone_name: 'Deep Waters', zone_bounds: { x: 60, y: 0, w: 60, h: 60, color: '#2980b940' } },
    { zone_name: 'Rocky Reef', zone_bounds: { x: 0, y: 60, w: 40, h: 60, color: '#8e44ad40' } },
    { zone_name: 'The Trench', zone_bounds: { x: 40, y: 40, w: 40, h: 40, color: '#c0392b40' } },
    { zone_name: 'Foggy Banks', zone_bounds: { x: 80, y: 60, w: 40, h: 60, color: '#f39c1240' } },
    { zone_name: 'Lobster Alley', zone_bounds: { x: 40, y: 80, w: 40, h: 40, color: '#1abc9c40' } },
  ];

  for (const t of territories) {
    const { error } = await supabase.from('territories').upsert(
      { zone_name: t.zone_name, zone_bounds: t.zone_bounds },
      { onConflict: 'zone_name', ignoreDuplicates: true }
    );
    if (error) {
      console.log(`  Territory "${t.zone_name}": ${error.message}`);
    } else {
      console.log(`  ✅ Territory "${t.zone_name}" ready`);
    }
  }

  console.log('\nDone! If tables weren\'t auto-created, run the SQL manually first, then re-run this script.');
}

setup().catch(console.error);
