# Magpy interns dashboard: Vercel version

Static frontend in `public/`, one Vercel Function (`api/[...path].js` when the repo root is deployed, or `vercel/api/[...path].js` if this folder is the project root) serving every `/api/*` route with the same shapes as `../server.js`. Tasks are read from the Notion **Solavant Interns · Tasks** database. Hours, meetings, comments, and asks are a single JSON document in Upstash Redis when that is connected.

- Live sync is **polling**: the page calls `/api/data?since=<rev>` every ~2 s while visible (~10 s when hidden) and re-renders only on change. The open edit modal is kept.
- Concurrency: the document has a revision counter. Writes go through an atomic Lua compare-and-set (`EVAL`); on conflict the function re-reads and re-applies the change (up to 12 tries), so simultaneous edits don't overwrite each other.
- Empty store is seeded with the 8 starter tasks.

## Deploy
1. Import the GitHub repo on the Vercel team. Leave **Root Directory** as the repository root (do not set it to `vercel`). The root `vercel.json` copies this folder's `public/` into the static output, then lays the Solavant portal (`portal/`) on top: `/` is the Solavant front page, `/login.html` is Google sign-in, the intern dashboard is `/magpy/`, and Solavant Private Capital is `/privates/`. `/api/*` goes to the function. `middleware.js` at the repo root gates pages when `GOOGLE_CLIENT_ID` is set.
2. Set `NOTION_TOKEN` to a Notion internal integration secret (Production and Preview). In Notion, open **Solavant Interns · Tasks** and share it with that integration. `NOTION_DATABASE_ID` is optional and defaults to `057cf17c94bb4acf988f926775660ab8`. The stale mirror `67b0ae62643246289339316b82f2a13e` is ignored if you set it. The older Intern Tasks id `66707f68214540aabdbc3c14ccacc623` 404s for the SCM Team integration. `NOTION_SYNC_MS` is optional (milliseconds, minimum 5000, default 30000). The board's title property is "Task name", Status is a status property ("Not started" shows as Open), Owner is a select, and there is no Description column. Set `PRIVATES_NOTION_DATABASE_ID` to `c7832a86522a4e26ae7311d9662c460b` (Solavant Private · Tasks) for Production and Preview. Privates uses the same `NOTION_TOKEN` and writes `/api/privates/*`, with its own store key `privates:state`, so Magpy tasks are never copied. Until the SCM Team integration can see that database, Notion returns 404, the section stays empty, and the page says it is not connected. The next pull fills it in after the connection is added.
3. Optional, for hours, meetings, comments, and asks to survive a new function instance: **Storage → Marketplace → Upstash Redis → Create**, and connect it. That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (also accepted: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Without Redis, those fields live in the instance and can reset. Tasks still come back from Notion.
4. Optional password: `APP_PASSWORD` and `SESSION_SECRET` (any long random string). Leave `APP_PASSWORD` unset for no password login. Google sign-in, when `GOOGLE_CLIENT_ID` is set, replaces that password gate: also set `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, and `ALLOWED_EMAILS` (comma or space separated; `@domain.com` allows a domain; empty or `*` allows any verified Google account). Optional `PUBLIC_URL` pins the OAuth redirect host. `SYNC_KEY` (32+ characters) lets a bearer token call `/api/*` without a browser session.
5. Redeploy so env vars take effect. Open the dashboard and click **Refresh Notion**, or wait for the next poll (the page checks every ~2 seconds; Notion itself is pulled at most once per `NOTION_SYNC_MS`).

Until `NOTION_TOKEN` is set, the board stays on its local starter tasks and Refresh Notion says so. After a successful pull, tasks that have no Notion page are dropped, and dashboard edits are written back to Solavant Interns · Tasks. `public/style.css` is the stylesheet from the Oct 13 Solavant deployment.

## Local testing
- `npm run dev` : harness on http://localhost:3000 (serves `public/`, mounts the API, file store in `.data/`). Env: `PORT`, `DATA_DIR`, `APP_PASSWORD`, or Upstash vars to use Redis.
- `npm test` : API tests (file store and a fake Upstash REST server, including 30 parallel writes).
- `node test/e2e.js` : two headless Chrome clients (needs puppeteer-core), sync, modal, persistence, login.

## Limits
- Sync delay up to ~2 s (10 s in a background tab), and each open tab makes ~30 requests/min (free-tier function invocation use).
- Login rate limiting is per function instance (best effort), not global.
- No automatic backups (the Node version has them). Upstash has its own persistence; export via `/api/data` if needed.
- Whole non-task state is one document (fine for this size; keep it under Upstash's ~1 MB request limit on the free plan). Task rows are the Notion board, refreshed on read when the stored snapshot is older than `NOTION_SYNC_MS`, or immediately from **Refresh Notion**.
- Meetings are stored only; Google Calendar sync still needs the external helper using `/api/meetings/pending` and `/synced`.
