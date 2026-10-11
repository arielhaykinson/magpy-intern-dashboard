# Magpy Intern Dashboard

Shared task list, calendar, board and hours tracker for the Magpy interns. Several people can edit at once; changes sync live and are saved to a JSON file. No dependencies beyond Node.js.

## Run
    node server.js
Then open http://localhost:8765

## Config (env vars)
- `PORT` (default `8765`)
- `APP_PASSWORD` – shared team password. When set, every `/api/*` route and the live-sync stream require login (signed, HttpOnly session cookie, 30 days; `Secure` behind https). When unset, login is disabled (handy for local use).
- `SESSION_SECRET` – long random string used to sign session cookies (recommended with `APP_PASSWORD`; if omitted, one is derived from the password). Changing it logs everyone out.
- `DATA_DIR` (default `./data`) – data is stored in `$DATA_DIR/db.json`, with backups in `$DATA_DIR/backups/` every 10 minutes (newest 48 kept).

## Deploy
- Render: `render.yaml` blueprint (Node web service + persistent disk at `/data`).
- Docker: `docker build -t magpy . && docker run -p 8765:8765 -v magpy-data:/data magpy`

On Render, set `APP_PASSWORD` and `SESSION_SECRET` in the service's Environment tab (they are declared in `render.yaml` with `sync: false`, so they are never stored in the repo). Failed logins are rate limited (5 per 10 minutes per IP).

## Comments and activity
Each task has a comment thread in its edit window, and the Activity tab lists recent changes (created, status/priority/owner/due changes, comments, meeting requests) with who and when. Both sync live and are stored in `db.json` (`comments`, `activity`); older data files load unchanged.

## Cloudflare Workers (free plan)
The `cloudflare/` folder is a port of `server.js` to Cloudflare Workers. The Node server is unchanged and still works locally. Same `/api/*` endpoints and JSON shapes, so the frontend runs unmodified.

- `cloudflare/src/index.js` – Worker; `/api/*` goes to a single SQLite-backed Durable Object (`Dashboard`) that holds all state (tasks, hours, meetings, asks, comments, activity), serves live sync over SSE (`/api/events`), and handles login (Web Crypto HMAC session cookie, 5 failed tries / 10 min per IP).
- Static frontend is served by Workers Static Assets from `cloudflare/public/`, a copy of `index.html`, `app.js`, `store.js`, `style.css`, `fonts/`. After changing the frontend in the repo root, run `npm run sync` in `cloudflare/` (`npm run deploy` and `npm run dev` do this for you).
- Seeded with the same 8 starter tasks on first use. Data lives in the Durable Object, not in `data/db.json` (no import; the Node data file is not uploaded).

### Deploy
Needs Node 22+ and a free Cloudflare account.

    cd cloudflare
    npm install
    npx wrangler login                      # or: export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
    npx wrangler deploy                     # first deploy creates the Worker; prints https://magpy-dashboard.<your-subdomain>.workers.dev
    npx wrangler secret put APP_PASSWORD    # shared team password (login is off if unset)
    npx wrangler secret put SESSION_SECRET  # long random string, e.g. `openssl rand -hex 32`

Use `npm run deploy` instead of `npx wrangler deploy` to sync `public/` first. API token permissions: "Edit Cloudflare Workers" template (Workers Scripts: Edit; Account Settings: Read). Setting a secret on a deployed Worker takes effect immediately; changing `SESSION_SECRET` logs everyone out.

Local dev: `npm run dev` (http://localhost:8787, state in `.wrangler/state`, set secrets in a git-ignored `cloudflare/.dev.vars`). Integration test against a running dev server: `BASE=http://127.0.0.1:8787 node test.js` (add `EXPECT_LOGIN=1 PW=<password>` when a password is set).

### Free-plan notes
- Durable Objects are free only with SQLite storage (`new_sqlite_classes`, already configured). Free limits: 100k Worker requests/day, 100k DO requests/day, 13,000 GB-s DO duration/day, 5 GB storage.
- Static asset requests are free and unlimited. Only `/api/*` counts as Worker requests.
- Live sync holds SSE streams open, which keeps the Durable Object awake while anyone has the dashboard open (about 128 MB × open time). One object running all day is roughly 11k GB-s, so the free duration allowance covers a small team, but a tab left open around the clock could hit the daily cap. The object sleeps when nobody is connected. If that ever bites, switch to hibernating WebSockets (needs a small `store.js` change).
- Failed-login counters are in memory and reset if the object restarts.
