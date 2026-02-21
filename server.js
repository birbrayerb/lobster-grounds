const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const TICK_RATE = 20; // 20 Hz
const TICK_MS = 1000 / TICK_RATE;
const TRAP_LINGER_MS = 5 * 60 * 1000; // keep disconnected player traps for 5 min
const CHAT_EXPIRE_MS = 5000;

// Nice boat color palette
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
const players = new Map(); // id -> player state
const traps = new Map(); // id -> trap state  
const chatMessages = []; // { id, playerId, name, text, timestamp }

// Global game time
let gameTime = { day: 1, timeOfDay: 6, weather: 'clear', weatherTimer: 300 };

function randomName() {
  return NAMES_ADJ[Math.floor(Math.random() * NAMES_ADJ.length)] + ' ' +
         NAMES_NOUN[Math.floor(Math.random() * NAMES_NOUN.length)];
}

function randomColor() {
  return BOAT_COLORS[Math.floor(Math.random() * BOAT_COLORS.length)];
}

// HTTP server for Render health checks + WebSocket upgrade
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(`Lobster Grounds server - ${players.size} players online`);
});
const wss = new WebSocketServer({ server });
server.listen(PORT, () => console.log(`Lobster Grounds server running on port ${PORT}`));

wss.on('connection', (ws) => {
  const id = nextPlayerId++;
  const name = randomName();
  const color = randomColor();
  
  // Spawn at dock area
  const player = {
    id, name, color, ws,
    x: (5 + 4) * 40 + Math.random() * 80,
    y: (55 + 5) * 40 + Math.random() * 80,
    angle: 0, speed: 0,
    holdCount: 0,
    trapsSet: 0,
  };
  
  players.set(id, player);
  console.log(`Player ${id} (${name}) connected. Total: ${players.size}`);
  
  // Send welcome with assigned id/name/color
  ws.send(JSON.stringify({
    type: 'welcome',
    id, name, color,
    gameTime: { ...gameTime },
  }));
  
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(id, msg);
    } catch (e) {}
  });
  
  ws.on('close', () => {
    players.delete(id);
    // Mark traps as orphaned but keep them
    for (const [tid, trap] of traps) {
      if (trap.ownerId === id) {
        trap.orphanedAt = Date.now();
      }
    }
    console.log(`Player ${id} (${name}) disconnected. Total: ${players.size}`);
  });
});

function handleMessage(playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;
  
  switch (msg.type) {
    case 'position':
      player.x = msg.x;
      player.y = msg.y;
      player.angle = msg.angle;
      player.speed = msg.speed;
      player.holdCount = msg.holdCount || 0;
      player.trapsSet = msg.trapsSet || 0;
      break;
      
    case 'dropTrap':
      const trapId = nextTrapId++;
      traps.set(trapId, {
        id: trapId,
        ownerId: playerId,
        ownerName: player.name,
        x: msg.x,
        y: msg.y,
        timeSet: gameTime.timeOfDay,
        daySet: gameTime.day,
        createdAt: Date.now(),
      });
      break;
      
    case 'haulTrap':
      const trap = traps.get(msg.trapId);
      if (trap && trap.ownerId === playerId) {
        traps.delete(msg.trapId);
      }
      break;
      
    case 'chat':
      const text = (msg.text || '').slice(0, 200);
      if (!text) break;
      chatMessages.push({
        playerId,
        name: player.name,
        text,
        timestamp: Date.now(),
      });
      break;
  }
}

// Game tick - broadcast state
function tick() {
  // Update game time
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
  
  // Clean up expired chat messages
  const now = Date.now();
  while (chatMessages.length > 0 && now - chatMessages[0].timestamp > CHAT_EXPIRE_MS) {
    chatMessages.shift();
  }
  
  // Clean up orphaned traps
  for (const [tid, trap] of traps) {
    if (trap.orphanedAt && now - trap.orphanedAt > TRAP_LINGER_MS) {
      traps.delete(tid);
    }
  }
  
  // Build state snapshot
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
    // Calculate readiness based on game time
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
