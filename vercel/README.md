# Magpy interns dashboard: Vercel version

Static frontend in `public/`, one Vercel Function (`api/[...path].js`, Node) serving every `/api/*` route with the same shapes as `../server.js`, and state stored as a single JSON document in Upstash Redis (REST).

- Live sync is **polling**: the page calls `/api/data?since=<rev>` every ~2 s while visible (~10 s when hidden) and re-renders only on change. The open edit modal is kept.
- Concurrency: the document has a revision counter. Writes go through an atomic Lua compare-and-set (`EVAL`); on conflict the function re-reads and re-applies the change (up to 12 tries), so simultaneous edits don't overwrite each other.
- Empty store is seeded with the 8 starter tasks.

## Deploy
1. Create a Vercel account and import the GitHub repo (set **Root Directory** to `vercel`), or run `npx vercel` / `npx vercel deploy --prod` from this folder.
2. In the project: **Storage → Marketplace → Upstash Redis → Create**, connect it to the project. This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (also accepted: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. Optional password: add env vars `APP_PASSWORD` (and `SESSION_SECRET`, any long random string). Leave `APP_PASSWORD` unset for no login.
4. Redeploy so env vars take effect (`vercel deploy --prod`).

Without Redis configured on Vercel the API returns an error (it will not silently use a non-persistent file).

## Local testing
- `npm run dev` : harness on http://localhost:3000 (serves `public/`, mounts the API, file store in `.data/`). Env: `PORT`, `DATA_DIR`, `APP_PASSWORD`, or Upstash vars to use Redis.
- `npm test` : API tests (file store and a fake Upstash REST server, including 30 parallel writes).
- `node test/e2e.js` : two headless Chrome clients (needs puppeteer-core), sync, modal, persistence, login.

## Limits
- Sync delay up to ~2 s (10 s in a background tab), and each open tab makes ~30 requests/min (free-tier function invocation use).
- Login rate limiting is per function instance (best effort), not global.
- No automatic backups (the Node version has them). Upstash has its own persistence; export via `/api/data` if needed.
- Whole state is one document (fine for this size; keep it under Upstash's ~1 MB request limit on the free plan).
- Meetings are stored only; Google Calendar sync still needs the external helper using `/api/meetings/pending` and `/synced`.
