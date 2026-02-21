# 🦞⚔️ Lobster Wars

A multiplayer lobster fishing game with territory control. Battle for the best fishing grounds!

## Architecture

- **Client**: Single `index.html` file with Canvas game engine + Supabase Auth
- **Server**: `server.js` (Node.js + WebSocket) deployed on Render
- **Database**: Supabase (PostgreSQL) for auth, player data, territories, leaderboard

## Setup

### 1. Database
Run `schema.sql` in the [Supabase SQL Editor](https://supabase.com/dashboard/project/banjuonrhsfrfbudwelf/sql/new) to create tables and seed territory data.

### 2. Server (Render)
Set environment variable on Render:
```
SUPABASE_SERVICE_KEY=<your-service-role-key>
```

### 3. Client
Just open `index.html` in a browser, or host it on any static file server / GitHub Pages.

## Features

- **Auth**: Email/password login & signup via Supabase
- **Multiplayer**: Real-time WebSocket with position sync, chat, boat collisions
- **Persistent Progress**: Player data (cash, upgrades, inventory) saved to database
- **Territory Zones**: 6 named zones visible on map and minimap (claiming mechanics TBD in Phase 2)
- **Gameplay**: Trap setting, hauling, underwater view, weather, day/night cycle

## Dev

```bash
npm install
npm start  # starts server on port 3001
```

Local testing: open `index.html?WS_URL=ws://localhost:3001`
