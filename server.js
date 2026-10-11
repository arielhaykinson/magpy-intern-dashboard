// Magpy dashboard server: static files + JSON API + SSE. No dependencies (Node 18+).
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = +process.env.PORT || 8765, ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data"), DB = path.join(DATA_DIR, "db.json"), BK = path.join(DATA_DIR, "backups");
fs.mkdirSync(BK, { recursive: true });
const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const seedTasks = () => {
  const now = Date.now(), mk = (title, priority, i) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "", updatedAt: now + i });
  return ["Natrion source list|High", "Natrion memo onto the template|High", "Natrion sonar|High", "Natrion growth drivers|High",
    "KairosLive facts file|High", "Robotaxi primer|High", "SAFE math explainer|Low", "Deal Evidence File blank template|Low"]
    .map((s, i) => mk(...s.split("|"), i));
};
let db, dirty = true;
try { db = JSON.parse(fs.readFileSync(DB, "utf8")); } catch { db = null; }
if (!db || !Array.isArray(db.tasks)) {
  db = { seeded: true, tasks: seedTasks(), hours: {}, tombstones: {} };
  persist();
}
db.hours ||= {}; db.tombstones ||= {};
function persist() { const tmp = DB + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, DB); dirty = true; }
const view = () => ({ tasks: db.tasks, hours: Object.fromEntries(Object.entries(db.hours).map(([k, v]) => [k, v.value])) });

// Backups: on start and every 10 min if changed; keep newest 48.
function backup() {
  if (!dirty) return; dirty = false;
  const n = "db-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  try { fs.copyFileSync(DB, path.join(BK, n)); const fs_ = fs.readdirSync(BK).filter((f) => f.startsWith("db-")).sort(); fs_.slice(0, -48).forEach((f) => fs.unlinkSync(path.join(BK, f))); } catch (e) { console.error("backup", e); }
}
backup(); setInterval(backup, 10 * 60 * 1000).unref();

const clients = new Set();
function broadcast(by) { const m = `event: change\ndata: ${JSON.stringify({ by: by || "", t: Date.now() })}\n\n`; for (const r of clients) r.write(m); }
setInterval(() => { for (const r of clients) r.write(": ping\n\n"); }, 15000).unref();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const body = (req) => new Promise((ok, no) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e6) { no(new Error("big")); req.destroy(); } }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { no(e); } }); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
const FIELDS = ["title", "status", "owner", "due", "priority", "area", "notes"];

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.pathname, by = req.headers["x-user"] || "";
  try {
    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write("retry: 1000\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
    }
    if (p === "/api/data" && req.method === "GET") return send(res, 200, view());
    if (p === "/api/task" && req.method === "PUT") {
      const t = await body(req); if (!t.id || typeof t.title !== "string") return send(res, 400, { error: "bad task" });
      t.updatedAt = +t.updatedAt || Date.now();
      const i = db.tasks.findIndex((x) => x.id === t.id), cur = db.tasks[i];
      if ((cur && cur.updatedAt > t.updatedAt) || (db.tombstones[t.id] || 0) > t.updatedAt) return send(res, 200, { applied: false, task: cur || null });
      const nt = { id: t.id, updatedAt: t.updatedAt }; for (const k of FIELDS) nt[k] = String(t[k] ?? "");
      i >= 0 ? (db.tasks[i] = nt) : db.tasks.push(nt); delete db.tombstones[t.id];
      persist(); broadcast(by); return send(res, 200, { applied: true, task: nt });
    }
    if (p.startsWith("/api/task/") && req.method === "DELETE") {
      const id = decodeURIComponent(p.slice(10)), at = +url.searchParams.get("updatedAt") || Date.now(), cur = db.tasks.find((x) => x.id === id);
      if (cur && cur.updatedAt > at) return send(res, 200, { applied: false });
      db.tasks = db.tasks.filter((x) => x.id !== id); db.tombstones[id] = at; persist(); broadcast(by); return send(res, 200, { applied: true });
    }
    if (p === "/api/hours" && req.method === "PUT") {
      const { key, value, updatedAt } = await body(req), at = +updatedAt || Date.now();
      if (!key || !isFinite(+value)) return send(res, 400, { error: "bad hours" });
      if (db.hours[key] && db.hours[key].updatedAt > at) return send(res, 200, { applied: false });
      db.hours[key] = { value: +value, updatedAt: at }; persist(); broadcast(by); return send(res, 200, { applied: true });
    }
    if (p === "/api/reset" && req.method === "POST") {
      db = { seeded: true, tasks: seedTasks(), hours: {}, tombstones: {} }; persist(); broadcast(by); return send(res, 200, { ok: true });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    // static
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
