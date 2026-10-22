const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 8765, ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data"), DB = path.join(DATA_DIR, "db.json"), BK = path.join(DATA_DIR, "backups");
fs.mkdirSync(BK, { recursive: true });
const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const seedTasks = () => {
  const now = Date.now(), mk = (title, priority, i) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "", updatedAt: now + i });
  return ["Natrion source list|High", "Natrion memo onto the template|Medium", "Natrion sonar|Medium", "Natrion growth drivers|Medium",
    "KairosLive facts file|Medium", "Robotaxi primer|Medium", "SAFE math explainer|Low", "Deal Evidence File blank template|Low"]
    .map((s, i) => mk(...s.split("|"), i));
};
let db, dirty = true;
try { db = JSON.parse(fs.readFileSync(DB, "utf8")); } catch { db = null; }
if (!db || !Array.isArray(db.tasks)) {
  db = { seeded: true, tasks: seedTasks(), hours: {}, tombstones: {} };
  persist();
}
const PRIS = ["Urgent", "High", "Medium", "Low"];
const normPri = (v) => PRIS.find((p) => p.toLowerCase() === String(v ?? "").trim().toLowerCase()) || "Low";
let migrated = false;
for (const t of db.tasks) { const n = normPri(t.priority); if (t.priority !== n) { t.priority = n; migrated = true; } }
// One-time: starter tasks that are still unedited seed values get Medium (Natrion source list stays High).
if (!db.priorityMigrated) {
  const M = ["Natrion memo onto the template", "Natrion sonar", "Natrion growth drivers", "KairosLive facts file", "Robotaxi primer"];
  const base = (db.tasks.find((t) => t.title === "Natrion source list") || {}).updatedAt;
  for (const t of db.tasks) if (M.includes(t.title) && t.priority === "High" && t.status === "Open" && t.owner === "Unassigned" && !t.due && t.area === "Magpy" && !t.notes && base && Math.abs(t.updatedAt - base) < 50) { t.priority = "Medium"; t.updatedAt = Date.now(); }
  db.priorityMigrated = true; migrated = true;
}
db.hours ||= {}; db.tombstones ||= {}; db.meetings ||= []; db.asks ||= []; db.comments ||= {}; db.activity ||= [];
function persist() { const tmp = DB + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, DB); dirty = true; }
if (migrated) persist();
let notionPublicFn = () => ({ configured: !!process.env.NOTION_TOKEN, ok: false, databaseId: "", syncedAt: 0, error: "", warning: "", count: (db.tasks || []).filter((t) => t.notionId).length });
const shownTasks = () => process.env.NOTION_TOKEN ? (db.tasks || []).filter((t) => t && (t.notionId || t.localDirty)) : db.tasks;
const view = () => ({ tasks: shownTasks(), meetings: db.meetings, asks: db.asks, comments: db.comments, activity: db.activity.slice(-150).reverse(), hours: Object.fromEntries(Object.entries(db.hours).map(([k, v]) => [k, v.value])), notion: notionPublicFn() });

function backup() {
  if (!dirty) return; dirty = false;
  const n = "db-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  try { fs.copyFileSync(DB, path.join(BK, n)); const fs_ = fs.readdirSync(BK).filter((f) => f.startsWith("db-")).sort(); fs_.slice(0, -48).forEach((f) => fs.unlinkSync(path.join(BK, f))); } catch (e) { console.error("backup", e); }
}
backup(); setInterval(backup, 10 * 60 * 1000).unref();

const clients = new Set();
function broadcast(by) { const m = `event: change\ndata: ${JSON.stringify({ by: by || "", t: Date.now() })}\n\n`; for (const r of clients) r.write(m); }
setInterval(() => { for (const r of clients) r.write(": ping\n\n"); }, 15000).unref();

let notionSync = { refresh: async () => notionPublicFn(), pushTask: async (task) => ({ task, error: "" }), archiveTask: async () => ({ error: "" }) };
const notionReady = import("./notion-sync.mjs").then((m) => {
  notionPublicFn = () => m.notionPublic(db.notion, !!process.env.NOTION_TOKEN, db.tasks);
  notionSync = m.createNotionSync({
    token: () => process.env.NOTION_TOKEN || "",
    databaseId: () => process.env.NOTION_DATABASE_ID || "",
    syncMs: () => process.env.NOTION_SYNC_MS,
    apiBase: () => process.env.NOTION_API_BASE || "",
    getState: () => db,
    commit(next, meta) {
      db.tasks = next.tasks; db.tombstones = next.tombstones; db.notion = next.notion;
      if (meta.tasksChanged) {
        const n = (next.tasks || []).filter((t) => t.notionId).length;
        log("Notion", "sync", null, `synced ${n} tasks from Solavant Interns · Tasks`);
        const dropped = meta.dropped || [];
        if (dropped.length) {
          const names = dropped.join(", ");
          log("Notion", "sync", null, names.length > 150 ? `removed ${dropped.length} local-only tasks that are not on Solavant Interns · Tasks` : `removed local-only tasks not on Solavant Interns · Tasks: ${names}`);
        }
        persist(); broadcast("notion");
      }
    },
  });
  const ms = Math.max(5000, +process.env.NOTION_SYNC_MS || m.DEFAULT_SYNC_MS);
  const tick = () => notionSync.refresh(false).catch((e) => console.error("notion", e));
  setInterval(tick, ms).unref();
  if (process.env.NOTION_TOKEN) tick();
}).catch((e) => console.error("notion setup", e));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const body = (req) => new Promise((ok, no) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e6) { no(new Error("big")); req.destroy(); } }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { no(e); } }); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };

const MSTAT = ["requested", "on calendar", "cancelled"], RMIN = [0, 10, 60, 1440];
const mid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isoOk = (s) => typeof s === "string" && !isNaN(Date.parse(s));
function cleanMeeting(m, cur, by) {
  const o = cur ? { ...cur } : { id: mid(), googleEventId: null, createdBy: by || "", status: "requested", meetLink: null };
  const src = cur ? { ...cur, ...m } : m;
  if (typeof src.title !== "string" || !src.title.trim()) return { error: "title required" };
  if (!isoOk(src.start) || !isoOk(src.end)) return { error: "start/end must be ISO date-time strings" };
  if (Date.parse(src.end) <= Date.parse(src.start)) return { error: "end must be after start" };
  o.title = src.title.trim(); o.start = new Date(src.start).toISOString(); o.end = new Date(src.end).toISOString();
  o.attendees = (Array.isArray(src.attendees) ? src.attendees : []).map((a) => String(a).trim()).filter(Boolean);
  o.notes = String(src.notes ?? ""); o.meet = !!src.meet;
  o.reminderMinutes = RMIN.includes(+src.reminderMinutes) ? +src.reminderMinutes : 0;
  if (m.createdBy && !cur) o.createdBy = String(m.createdBy);
  return { m: o };
}
const touch = (m) => { m.updatedAt = Date.now(); return m; };
const aid = () => "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || (APP_PASSWORD ? crypto.createHash("sha256").update("magpy-session|" + APP_PASSWORD).digest("hex") : "");
const SESSION_MS = 30 * 24 * 3600 * 1000, COOKIE = "magpy_session";
const hmac = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
const safeEq = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const makeSession = () => { const exp = String(Date.now() + SESSION_MS); return exp + "." + hmac("v1." + exp); };
function hasSession(req) {
  const m = /(?:^|;\s*)magpy_session=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return false;
  const [exp, sig] = m[1].split("."); if (!exp || !sig || !(+exp > Date.now())) return false;
  const want = hmac("v1." + exp); return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const cookie = (req, val, maxAge) => `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
const fails = new Map();
const FAIL_MAX = 5, FAIL_WIN = 10 * 60 * 1000;
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (t - v.first > FAIL_WIN) fails.delete(k); }, 60000).unref();

const actId = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function log(by, kind, task, text) {
  db.activity.push({ id: actId(), at: new Date().toISOString(), who: String(by || "").slice(0, 40), kind, taskId: task ? task.id : "", title: task ? task.title : "", text: String(text || "").slice(0, 200) });
  if (db.activity.length > 500) db.activity = db.activity.slice(-500);
}
const LBL = { status: "status", priority: "priority", owner: "owner", due: "due date" };
function logTaskChange(by, cur, nt) {
  if (!cur) return log(by, "created", nt, "created this task");
  for (const k of ["status", "priority", "owner", "due"]) if ((cur[k] || "") !== (nt[k] || "")) log(by, "change", nt, `changed ${LBL[k]}: ${cur[k] || "none"} → ${nt[k] || "none"}`);
  if (cur.title !== nt.title) log(by, "change", nt, `renamed from “${cur.title}”`);
}

const MAX_DOCS = 20;
function cleanDocs(input, prev, by) {
  const old = new Map((Array.isArray(prev) ? prev : []).map((d) => [d.id, d])), seen = new Set(), out = [];
  for (const d of Array.isArray(input) ? input : []) {
    if (!d || typeof d !== "object" || typeof d.url !== "string") continue;
    let u; try { u = new URL(d.url.trim()); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    let id = typeof d.id === "string" && /^[\w-]{1,40}$/.test(d.id) ? d.id : "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (seen.has(id)) continue; seen.add(id);
    const o = old.get(id);
    out.push(o ? { ...o, title: String(d.title ?? o.title ?? "").trim().slice(0, 120) } : { id, url: u.href.slice(0, 2000), title: String(d.title ?? "").trim().slice(0, 120), addedBy: String(d.addedBy || by || "").slice(0, 40), addedAt: new Date().toISOString() });
    if (out.length >= MAX_DOCS) break;
  }
  return out;
}
const docLabel = (d) => { try { const u = new URL(d.url), p = u.pathname; return d.title || (u.hostname === "docs.google.com" ? (p.startsWith("/document") ? "Doc" : p.startsWith("/presentation") ? "Slides" : p.startsWith("/spreadsheets") ? "Sheet" : "Doc") : u.hostname.replace(/^www\./, "")); } catch { return d.title || "doc"; } };
function logDocs(by, cur, nt) {
  const had = new Set(((cur && cur.docs) || []).map((d) => d.id));
  for (const d of nt.docs) if (!had.has(d.id)) log(by, "doc", nt, "attached a doc: " + docLabel(d));
}
const FIELDS = ["title", "status", "owner", "due", "priority", "area", "notes"];

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.pathname, by = req.headers["x-user"] || "";
  try {
    await notionReady;
    if (p === "/api/session" && req.method === "GET") return send(res, 200, { required: !!APP_PASSWORD, ok: !APP_PASSWORD || hasSession(req) });
    if (p === "/api/login" && req.method === "POST") {
      if (!APP_PASSWORD) return send(res, 200, { ok: true, required: false });
      const ip = ipOf(req), f = fails.get(ip), t = Date.now();
      if (f && t - f.first > FAIL_WIN) fails.delete(ip);
      const cf = fails.get(ip);
      if (cf && cf.n >= FAIL_MAX) { const wait = Math.ceil((cf.first + FAIL_WIN - t) / 1000); res.setHeader("retry-after", wait); return send(res, 429, { error: "Too many attempts. Try again in a few minutes." }); }
      const b = await body(req);
      if (typeof b.password === "string" && safeEq(b.password, APP_PASSWORD)) {
        fails.delete(ip); res.setHeader("set-cookie", cookie(req, makeSession(), SESSION_MS / 1000)); return send(res, 200, { ok: true });
      }
      const n = fails.get(ip) || { n: 0, first: t }; n.n++; fails.set(ip, n);
      await new Promise((r) => setTimeout(r, 400));
      return send(res, 401, { error: "That password didn't match." });
    }
    if (p === "/api/logout" && req.method === "POST") { res.setHeader("set-cookie", cookie(req, "", 0)); return send(res, 200, { ok: true }); }
    if (p.startsWith("/api/") && APP_PASSWORD && !hasSession(req)) return send(res, 401, { error: "login required" });
    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write("retry: 1000\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
    }
    if (p === "/api/data" && req.method === "GET") { await notionSync.refresh(false); return send(res, 200, view()); }
    if (p === "/api/notion/refresh" && req.method === "POST") { const st = await notionSync.refresh(true); return send(res, 200, st); }
    if (p === "/api/task" && req.method === "PUT") {
      const t = await body(req); if (!t.id || typeof t.title !== "string") return send(res, 400, { error: "bad task" });
      t.updatedAt = +t.updatedAt || Date.now();
      const i = db.tasks.findIndex((x) => x.id === t.id), cur = db.tasks[i];
      if ((cur && cur.updatedAt > t.updatedAt) || (db.tombstones[t.id] || 0) > t.updatedAt) return send(res, 200, { applied: false, task: cur || null });
      const nt = { id: t.id, updatedAt: t.updatedAt }; for (const k of FIELDS) nt[k] = String(t[k] ?? ""); nt.priority = normPri(nt.priority);
      nt.docs = cleanDocs(t.docs === undefined ? (cur && cur.docs) : t.docs, cur && cur.docs, by);
      if (cur && cur.notionId) { nt.notionId = cur.notionId; nt.notionEdited = cur.notionEdited; nt.notionUrl = cur.notionUrl || ""; }
      logTaskChange(by, cur, nt); logDocs(by, cur, nt); i >= 0 ? (db.tasks[i] = nt) : db.tasks.push(nt); delete db.tombstones[t.id];
      const pushed = await notionSync.pushTask(nt);
      persist(); broadcast(by); return send(res, 200, { applied: true, task: nt, notionError: pushed.error || "" });
    }
    if (p.startsWith("/api/task/") && req.method === "DELETE") {
      const id = decodeURIComponent(p.slice(10)), at = +url.searchParams.get("updatedAt") || Date.now(), cur = db.tasks.find((x) => x.id === id);
      if (cur && cur.updatedAt > at) return send(res, 200, { applied: false });
      if (cur && cur.notionId) { const archived = await notionSync.archiveTask(cur); if (archived.error) return send(res, 502, { error: archived.error }); }
      if (cur) log(by, "deleted", cur, "deleted this task"); db.tasks = db.tasks.filter((x) => x.id !== id); delete db.comments[id]; db.tombstones[id] = at; persist(); broadcast(by); return send(res, 200, { applied: true });
    }
    const cm = p.match(/^\/api\/task\/([^/]+)\/comments$/);
    if (cm && req.method === "POST") {
      const id = decodeURIComponent(cm[1]), task = db.tasks.find((x) => x.id === id); if (!task) return send(res, 404, { error: "no such task" });
      const b = await body(req), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(res, 400, { error: "text required" }); if (text.length > 2000) return send(res, 400, { error: "comment too long (max 2000)" });
      const c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), author: String(b.author || by || "Someone").slice(0, 40), text, at: new Date().toISOString() };
      (db.comments[id] ||= []).push(c); log(c.author, "comment", task, "commented: " + (text.length > 90 ? text.slice(0, 90) + "…" : text));
      persist(); broadcast(by); return send(res, 201, { comment: c });
    }
    if (p === "/api/hours" && req.method === "PUT") {
      const { key, value, updatedAt } = await body(req), at = +updatedAt || Date.now();
      if (!key || !isFinite(+value)) return send(res, 400, { error: "bad hours" });
      if (db.hours[key] && db.hours[key].updatedAt > at) return send(res, 200, { applied: false });
      db.hours[key] = { value: +value, updatedAt: at }; persist(); broadcast(by); return send(res, 200, { applied: true });
    }
    if (p === "/api/meetings" && req.method === "GET") return send(res, 200, { meetings: db.meetings });
    if (p === "/api/meetings" && req.method === "POST") {
      const r = cleanMeeting(await body(req), null, by); if (r.error) return send(res, 400, r);
      db.meetings.push(touch(r.m)); log(by || r.m.createdBy, "meeting", { id: "", title: r.m.title }, "requested a meeting on " + r.m.start.slice(0, 10)); persist(); broadcast(by); return send(res, 201, { meeting: r.m });
    }
    if (p === "/api/meetings/pending" && req.method === "GET") {
      const inc = url.searchParams.get("include") === "cancelled";
      return send(res, 200, { meetings: db.meetings.filter((m) => m.status === "requested" || (inc && m.status === "cancelled" && m.googleEventId)) });
    }
    let mm = p.match(/^\/api\/meetings\/([^/]+)(\/synced)?$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]), i = db.meetings.findIndex((x) => x.id === id), cur = db.meetings[i];
      if (!cur) return send(res, 404, { error: "no such meeting" });
      if (mm[2] && req.method === "POST") {
        const b = await body(req); cur.googleEventId = b.googleEventId ?? null;
        if (b.meetLink !== undefined) cur.meetLink = b.meetLink || null;
        if (cur.status !== "cancelled") cur.status = "on calendar";
        touch(cur); persist(); broadcast(by); return send(res, 200, { meeting: cur });
      }
      if (!mm[2] && req.method === "GET") return send(res, 200, { meeting: cur });
      if (!mm[2] && req.method === "PUT") {
        const b = await body(req), r = cleanMeeting(b, cur, by); if (r.error) return send(res, 400, r);
        // any edit needs re-sync; explicit status (e.g. "cancelled") from the body is honoured
        r.m.status = MSTAT.includes(b.status) ? b.status : "requested";
        db.meetings[i] = touch(r.m); persist(); broadcast(by); return send(res, 200, { meeting: r.m });
      }
      if (!mm[2] && req.method === "DELETE") {
        // Soft cancel by default so the helper can remove the Google event; ?hard=1 deletes the record.
        if (url.searchParams.get("hard") === "1") db.meetings.splice(i, 1); else { cur.status = "cancelled"; touch(cur); }
        persist(); broadcast(by); return send(res, 200, { ok: true, meeting: url.searchParams.get("hard") === "1" ? null : cur });
      }
    }
    if (p === "/api/asks" && req.method === "GET") return send(res, 200, { asks: db.asks });
    if (p === "/api/asks" && req.method === "POST") {
      const b = await body(req), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(res, 400, { error: "text required" }); if (text.length > 2000) return send(res, 400, { error: "text too long (max 2000)" });
      const a = { id: aid(), text, createdBy: String(b.createdBy || by || "").slice(0, 40), createdAt: new Date().toISOString(), status: "new", reply: null, repliedAt: null };
      db.asks.push(a); persist(); broadcast(by); return send(res, 201, { ask: a });
    }
    if (p === "/api/asks/pending" && req.method === "GET") return send(res, 200, { asks: db.asks.filter((a) => a.status === "new") });
    const am = p.match(/^\/api\/asks\/([^/]+)\/reply$/);
    if (am && req.method === "POST") {
      const a = db.asks.find((x) => x.id === decodeURIComponent(am[1])); if (!a) return send(res, 404, { error: "no such ask" });
      const b = await body(req); if (typeof b.reply !== "string" || !b.reply.trim()) return send(res, 400, { error: "reply required" });
      a.reply = b.reply.trim(); a.status = "handled"; a.repliedAt = new Date().toISOString(); persist(); broadcast(by); return send(res, 200, { ask: a });
    }
    if (p === "/api/reset" && req.method === "POST") {
      db = { seeded: true, tasks: seedTasks(), hours: {}, tombstones: {}, meetings: [], asks: db.asks, comments: {}, activity: [], notion: null }; persist(); broadcast(by);
      await notionSync.refresh(true); return send(res, 200, { ok: true });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    let f = path.normalize(path.join(ROOT, p === "/" ? "index.html" : decodeURIComponent(p)));
    const rel = path.relative(ROOT, f);
    if (rel.startsWith("..") || rel.startsWith("data") || rel.startsWith("node_modules") || rel === "server.js" || rel.startsWith(".")) { res.writeHead(404); return res.end("not found"); }
    fs.readFile(f, (e, buf) => {
      if (e) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(buf);
    });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, "0.0.0.0", () => console.log("Magpy dashboard on :" + PORT, "data:", DB));
process.on("SIGTERM", () => process.exit(0));
