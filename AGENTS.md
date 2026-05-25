# AGENTS.md — Tags Tracker

## Stack
- **Backend**: Node.js + Express
- **Database**: SQLite via Prisma ORM
- **Frontend**: Vanilla JS SPA, Leaflet.js (OpenStreetMap), Tailwind CSS (CDN)
- **Entrypoint**: `server.js` — single Express server serving API + static files from `public/`

## Commands
| Command | Action |
|---|---|
| `npm start` | Production mode (`node server.js`) |
| `npm run dev` | Dev mode with nodemon |
| `npm run db:migrate` | `npx prisma migrate deploy` (run in Docker boot) |
| `npm run db:generate` | `npx prisma generate` |
| `postinstall` | Auto-runs `npx prisma generate` |

No lint, typecheck, or test commands exist.

## Setup (local, no Docker)
```
cp .env.example .env          # edit API_AUTH_TOKEN
npm install
npx prisma migrate dev --name init
npm run dev
```

## Docker
```
docker compose up --build -d   # runs on port 3000
docker compose down            # SQLite data persists in volume tags_data
```
Dockerfile runs `npx prisma migrate deploy` at boot before `node server.js`.

## API Auth
All `POST` routes require `Authorization: Bearer <API_AUTH_TOKEN>` header. Server **exits on startup** if `API_AUTH_TOKEN` is not set.

## Rate Limiting
- General: 500 req / 15 min
- `POST /api/location`: 120 req / min

## Database
Single Prisma model `Location` (table `locations`): id (cuid), device_name, latitude, longitude, battery_level (nullable Int), created_at. SQLite at `./data/tracking.db`.

## Environment
- `API_AUTH_TOKEN` — required, server exits if missing
- `DATABASE_URL` — default `file:./data/tracking.db`
- `PORT` — default `3000`
- `NODE_ENV` — `development` or `production`

## Structure
```
server.js          # Express app (API routes + static files)
prisma/schema.prisma
public/            # Static frontend (index.html, app.js, style.css)
data/              # SQLite db (gitignored, Docker volume)
```
Frontend polls `GET /api/location/latest` every 30s. All UI text in pt-BR.

## Key gotchas
- CSP in Helmet config whitelists CDN domains for Leaflet + Tailwind. Adding new CDN sources requires updating `server.js` CSP directives.
- `.env` is gitignored — always provide `.env.example` or instructions.
- `PROMPT.md` is the original development prompt, not user-facing docs. Don't modify.
