# Shuka — Local Amazon-Style Marketplace (Armenia)

Full-stack single-process marketplace built with Node.js, Express, SQLite (`better-sqlite3` in WAL mode), and a responsive frontend.

## Quick Start (One Command)

```bash
npm run setup && npm start
```

Open `http://localhost:3000`.

### Demo Accounts (created by `npm run seed`)
- **Seller 1:** `seller1@shuka.am` / `Password123!`
- **Seller 2:** `seller2@shuka.am` / `Password123!`
- **Buyer 1:** `buyer1@shuka.am` / `Password123!`

## Run Break-It Acceptance Tests

```bash
node tests/break_it.js
```

## Production Deployment & Daily Backup
- Deploy on a host with a persistent volume (e.g., Fly.io, Railway, Render Disk, or VPS with Caddy) pointing `DATA_DIR` to the mounted persistent path.
- Set `SESSION_SECRET` and `NODE_ENV=production` in environment variables.
- Daily SQLite backup command:
  ```bash
  sqlite3 /data/shuka.sqlite "VACUUM INTO '/data/backups/shuka-$(date +%F).sqlite';"
  ```
