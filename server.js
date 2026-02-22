const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3001;
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const TRAP_LINGER_MS = 5 * 60 * 1000;
const CHAT_EXPIRE_MS = 5000;
const SAVE_INTERVAL_MS = 30000;

// Supabase
const SUPABASE_URL = 'https://banjuonrhsfrfbudwelf.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const BOAT_COLORS = [
  '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400',
  '#16a085', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1abc9c', '#f39c12', '#2c3e50', '#e84393',
  '#00b894', '#6c5ce7', '#fd79a8', '#00cec9', '#ffeaa7',
];

const NAMES_ADJ = ['Salty', 'Old', 'Lucky', 'Rusty', 'Stormy', 'Foggy', 'Grizzled', 'Swift', 'Steady', 'Jolly', 'Crusty', 'Wily', 'Hardy', 'Brave', 'Lazy'];
const NAMES_NOUN = ['Pete', 'Jack', 'Lobstah', 'Skipper', 'Barnacle', 'Cap', 'Hank', 'Earl', 'Claws', 'Deckhand', 'Boatswain', 'Mariner', 'Fisher', 'Ahab', 'Smitty'];

let nextPlayerId = 1;
let nextTrapId = 1;

// World state
const players = new Map(); // visitorId or oderId -> player state
const traps = new Map();
const chatMessages = [];

// Territory data (loaded from DB on startup)
let territories = [];

// Global game time
let gameTime = { day: 1, timeOfDay: 6, weather: 'clear', weatherTimer: 300 };

function randomName() {
  return NAMES_ADJ[Math.floor(Math.random() * NAMES_ADJ.length)] + ' ' +
         NAMES_NOUN[Math.floor(Math.random() * NAMES_NOUN.length)];
}

function randomColor() {
  return BOAT_COLORS[Math.floor(Math.random() * BOAT_COLORS.length)];
}

// Load territories from DB
async function loadTerritories() {
  try {
    const { data, error } = await supabase.from('territories').select('*');
    if (error) {
      console.log('Failed to load territories:', error.message);
      return;
    }
    territories = data || [];
    console.log(`Loaded ${territories.length} territories`);
  } catch (e) {
    console.log('Territory load error:', e.message);
  }
}

// Verify Supabase JWT and get user
async function verifyToken(token) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch (e) {
    return null;
  }
}

// Load or create player record
async function loadPlayer(userId) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Not found - create new player
    const { data: newPlayer, error: insertError } = await supabase
      .from('players')
      .insert({ id: userId })
      .select()
      .single();
    if (insertError) {
      console.log('Failed to create player:', insertError.message);
      return null;
    }
    return newPlayer;
  }
  if (error) {
    console.log('Failed to load player:', error.message);
    return null;
  }
  return data;
}

// Save player to DB
async function savePlayer(playerId, playerState) {
  if (!playerState.userId) return;
  
  const { error } = await supabase
    .from('players')
    .update({
      display_name: playerState.name,
      cash: playerState.cash,
      level: playerState.level || 1,
      xp: playerState.xp || 0,
      upgrades: playerState.upgrades || {},
      inventory: playerState.inventory || {},
      stats: playerState.stats || {},
      updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })
    .eq('id', playerState.userId);

  if (error) console.log(`Save player ${playerState.userId} error:`, error.message);
}

// HTTP server
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(`Lobster Wars server - ${players.size} players online`);
});
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`Lobster Wars server running on port ${PORT}`);
  loadTerritories();
});

wss.on('connection', (ws, req) => {
  const id = nextPlayerId++;
  const name = randomName();
  const color = randomColor();

  const player = {
    id, name, color, ws,
    x: (5 + 4) * 40 + Math.random() * 80,
    y: (55 + 5) * 40 + Math.random() * 80,
    angle: 0, speed: 0,
    holdCount: 0, trapsSet: 0,
    // Auth fields
    userId: null,
    authenticated: false,
    dbData: null,
    // For periodic save
    cash: 500,
    level: 1,
    xp: 0,
    upgrades: {},
    inventory: {},
    stats: {},
    lastSave: Date.now(),
  };

  players.set(id, player);
  console.log(`Player ${id} (${name}) connected. Total: ${players.size}`);

  // Send welcome
  ws.send(JSON.stringify({
    type: 'welcome',
    id, name, color,
    gameTime: { ...gameTime },
    territories: territories.map(t => ({
      id: t.id, zone_name: t.zone_name, zone_bounds: t.zone_bounds,
      owner_id: t.owner_id, owner_name: null,
    })),
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(id, msg);
    } catch (e) {}
  });

  ws.on('close', async () => {
    // Save on disconnect
    const p = players.get(id);
    if (p && p.authenticated) {
      await savePlayer(id, p);
    }
    players.delete(id);
    for (const [tid, trap] of traps) {
      if (trap.ownerId === id) {
        trap.orphanedAt = Date.now();
      }
    }
    console.log(`Player ${id} disconnected. Total: ${players.size}`);
  });
});

async function handleMessage(playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;

  switch (msg.type) {
    case 'auth': {
      // Client sends JWT token after login
      const user = await verifyToken(msg.token);
      if (!user) {
        player.ws.send(JSON.stringify({ type: 'authError', message: 'Invalid token' }));
        return;
      }
      player.userId = user.id;
      player.authenticated = true;

      // Load player data from DB
      const dbData = await loadPlayer(user.id);
      if (dbData) {
        player.dbData = dbData;
        player.name = dbData.display_name || player.name;
        player.cash = dbData.cash;
        player.level = dbData.level;
        player.xp = dbData.xp;
        player.upgrades = dbData.upgrades;
        player.inventory = dbData.inventory;
        player.stats = dbData.stats;
      }

      // Send auth success with player data
      player.ws.send(JSON.stringify({
        type: 'authSuccess',
        playerData: {
          id: player.userId,
          display_name: player.name,
          cash: player.cash,
          level: player.level,
          xp: player.xp,
          upgrades: player.upgrades,
          inventory: player.inventory,
          stats: player.stats,
        },
      }));
      console.log(`Player ${playerId} authenticated as ${user.email} (${player.name})`);
      break;
    }

    case 'identify':
      if (msg.name) player.name = msg.name;
      if (msg.color) player.color = msg.color;
      for (const [tid, trap] of traps) {
        if (trap.ownerName === player.name && trap.orphanedAt) {
          trap.ownerId = player.id;
          trap.orphanedAt = null;
        }
      }
      player.ws.send(JSON.stringify({
        type: 'welcome',
        id: player.id, name: player.name, color: player.color,
        gameTime: { ...gameTime },
        territories: territories.map(t => ({
          id: t.id, zone_name: t.zone_name, zone_bounds: t.zone_bounds,
          owner_id: t.owner_id, owner_name: null,
        })),
      }));
      break;

    case 'updatePlayer':
      // Client sends updated game state for saving
      if (msg.cash !== undefined) player.cash = msg.cash;
      if (msg.level !== undefined) player.level = msg.level;
      if (msg.xp !== undefined) player.xp = msg.xp;
      if (msg.upgrades) player.upgrades = msg.upgrades;
      if (msg.inventory) player.inventory = msg.inventory;
      if (msg.stats) player.stats = msg.stats;
      if (msg.displayName) player.name = msg.displayName;
      break;

    case 'position':
      player.x = msg.x;
      player.y = msg.y;
      player.angle = msg.angle;
      player.speed = msg.speed;
      player.holdCount = msg.holdCount || 0;
      player.trapsSet = msg.trapsSet || 0;
      break;

    case 'dropTrap': {
      const trapId = nextTrapId++;
      traps.set(trapId, {
        id: trapId, ownerId: playerId, ownerName: player.name,
        x: msg.x, y: msg.y,
        timeSet: gameTime.timeOfDay, daySet: gameTime.day,
        createdAt: Date.now(),
      });
      break;
    }

    case 'haulTrap': {
      const trap = traps.get(msg.trapId);
      if (trap && trap.ownerId === playerId) {
        traps.delete(msg.trapId);
      }
      break;
    }

    case 'removeTrap': {
      // Remove trap by position (after hauling/collecting) — generous matching
      for (const [tid, trap] of traps) {
        if (trap.ownerId === playerId && Math.abs(trap.x - msg.x) < 50 && Math.abs(trap.y - msg.y) < 50) {
          traps.delete(tid);
          break;
        }
      }
      break;
    }

    case 'chat': {
      const text = (msg.text || '').slice(0, 200);
      if (!text) break;
      chatMessages.push({ playerId, name: player.name, text, timestamp: Date.now() });
      break;
    }
  }
}

// Periodic save for authenticated players
setInterval(() => {
  for (const [id, player] of players) {
    if (player.authenticated && Date.now() - player.lastSave >= SAVE_INTERVAL_MS) {
      savePlayer(id, player);
      player.lastSave = Date.now();
    }
  }
}, SAVE_INTERVAL_MS);

// Game tick
function tick() {
  gameTime.timeOfDay += 0.02 * (TICK_MS / 1000);
  if (gameTime.timeOfDay >= 24) {
    gameTime.timeOfDay -= 24;
    gameTime.day++;
  }
  gameTime.weatherTimer -= TICK_MS / 1000;
  if (gameTime.weatherTimer <= 0) {
    const weathers = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'foggy', 'rainy'];
    gameTime.weather = weathers[Math.floor(Math.random() * weathers.length)];
    gameTime.weatherTimer = 300 + Math.random() * 600;
  }

  const now = Date.now();
  while (chatMessages.length > 0 && now - chatMessages[0].timestamp > CHAT_EXPIRE_MS) {
    chatMessages.shift();
  }

  for (const [tid, trap] of traps) {
    if (trap.orphanedAt && now - trap.orphanedAt > TRAP_LINGER_MS) {
      traps.delete(tid);
    }
  }

  const playerList = [];
  for (const [, p] of players) {
    playerList.push({
      id: p.id, name: p.name, color: p.color,
      x: p.x, y: p.y, angle: p.angle, speed: p.speed,
      holdCount: p.holdCount, trapsSet: p.trapsSet,
    });
  }

  const trapList = [];
  for (const [, t] of traps) {
    let elapsed = gameTime.timeOfDay - t.timeSet + (gameTime.day - t.daySet) * 24;
    let readiness = Math.min(1, elapsed / 2.5);
    trapList.push({
      id: t.id, ownerId: t.ownerId, ownerName: t.ownerName,
      x: t.x, y: t.y, readiness,
    });
  }

  const snapshot = JSON.stringify({
    type: 'state',
    players: playerList,
    traps: trapList,
    chat: chatMessages.map(m => ({ name: m.name, text: m.text, age: now - m.timestamp })),
    gameTime: { day: gameTime.day, timeOfDay: gameTime.timeOfDay, weather: gameTime.weather },
  });

  for (const [, p] of players) {
    if (p.ws.readyState === 1) {
      p.ws.send(snapshot);
    }
  }
}

setInterval(tick, TICK_MS);
