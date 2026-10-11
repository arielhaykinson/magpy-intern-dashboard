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
