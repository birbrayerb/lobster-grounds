# 🦞 Lobster Grounds — Multiplayer

A real-time multiplayer lobster fishing game. Drop traps, haul lobsters, sell at the dock — with other players in the same ocean.

## Running

### Server
```bash
npm install
node server.js          # runs on port 3001 (or PORT env var)
```

### Client
Open `index.html` in a browser. By default connects to `ws://localhost:3001`.

To connect to a different server, add `?WS_URL=ws://your-server:3001` to the URL.

### Controls
- **WASD/Arrows** — Move boat
- **SPACE** — Drop trap / Enter shop / Haul trap
- **E** — Open shop (at dock)
- **Enter** — Chat
- **ESC** — Close panels

## Multiplayer Features
- Real-time player positions (20Hz sync)
- Shared trap buoys (everyone sees all traps)
- Chat with floating text bubbles
- Server-synced time & weather
- Player names above boats
- Smooth position interpolation

## Architecture
- **server.js** — Node.js WebSocket server (ws library)
- **index.html** — Self-contained game client
- Single-player features (shop, upgrades, hold) stay local per client
- Only positions, traps, and chat are synchronized
