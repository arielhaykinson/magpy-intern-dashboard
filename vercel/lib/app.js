// Magpy dashboard API for Vercel Functions. Port of ../server.js with a revisioned KV store.
const crypto = require("crypto");
const { getStore } = require("./kv");

const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const seedTasks = () => {
  const now = Date.now(), mk = (title, priority, i) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "", docs: [], updatedAt: now + i });
  return ["Natrion source list|High", "Natrion memo onto the template|Medium", "Natrion sonar|Medium", "Natrion growth drivers|Medium",
    "KairosLive facts file|Medium", "Robotaxi primer|Medium", "SAFE math explainer|Low", "Deal Evidence File blank template|Low"]
    .map((s, i) => mk(...s.split("|"), i));
};
const emptyDb = () => ({ seeded: true, priorityMigrated: true, tasks: seedTasks(), hours: {}, tombstones: {}, meetings: [], asks: [], comments: {}, activity: [] });
const PRIS = ["Urgent", "High", "Medium", "Low"];
const normPri = (v) => PRIS.find((p) => p.toLowerCase() === String(v ?? "").trim().toLowerCase()) || "Low";
function normalize(db) {
  db.tasks ||= []; db.hours ||= {}; db.tombstones ||= {}; db.meetings ||= []; db.asks ||= []; db.comments ||= {}; db.activity ||= [];
  for (const t of db.tasks) t.priority = normPri(t.priority);
  return db;
}
const view = (db, rev) => ({ rev, tasks: db.tasks, meetings: db.meetings, asks: db.asks, comments: db.comments, activity: db.activity.slice(-150).reverse(), hours: Object.fromEntries(Object.entries(db.hours).map(([k, v]) => [k, v.value])) });

// ---- Store access: read (seeding if empty) and mutate with optimistic concurrency.
async function readState() {
  const s = getStore();
  for (let i = 0; i < 6; i++) {
    const cur = await s.read();
    if (cur.db) return { rev: cur.rev, db: normalize(cur.db) };
    await s.cas(cur.rev, emptyDb()); // lost race = someone else seeded; re-read
  }
  throw new Error("could not initialise store");
}
// fn(db) -> { code, body, write } ; when write is falsy nothing is stored. Retries on revision conflict.
async function mutate(fn) {
  const s = getStore();
  for (let i = 0; i < 12; i++) {
    const { rev, db } = await readState();
    const r = fn(db);
    if (!r.write) return r;
    if (await s.cas(rev, db)) return r;
    await new Promise((ok) => setTimeout(ok, 15 + Math.random() * 60 * (i + 1)));
  }
  return { code: 503, body: { error: "busy, try again" } };
}

// ---- helpers (same as server.js)
const MSTAT = ["requested", "on calendar", "cancelled"], RMIN = [0, 10, 60, 1440];
const mid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const aid = () => "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const actId = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
function log(db, by, kind, task, text) {
  db.activity.push({ id: actId(), at: new Date().toISOString(), who: String(by || "").slice(0, 40), kind, taskId: task ? task.id : "", title: task ? task.title : "", text: String(text || "").slice(0, 200) });
  if (db.activity.length > 500) db.activity = db.activity.slice(-500);
}
const LBL = { status: "status", priority: "priority", owner: "owner", due: "due date" };
function logTaskChange(db, by, cur, nt) {
  if (!cur) return log(db, by, "created", nt, "created this task");
  for (const k of ["status", "priority", "owner", "due"]) if ((cur[k] || "") !== (nt[k] || "")) log(db, by, "change", nt, `changed ${LBL[k]}: ${cur[k] || "none"} → ${nt[k] || "none"}`);
  if (cur.title !== nt.title) log(db, by, "change", nt, `renamed from “${cur.title}”`);
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
function logDocs(db, by, cur, nt) {
  const had = new Set(((cur && cur.docs) || []).map((d) => d.id));
  for (const d of nt.docs) if (!had.has(d.id)) log(db, by, "doc", nt, "attached a doc: " + docLabel(d));
}
const FIELDS = ["title", "status", "owner", "due", "priority", "area", "notes"];

// ---- Auth (read env per request so it can change without a redeploy of code)
const cfg = () => {
  const pw = process.env.APP_PASSWORD || "";
  return { pw, secret: process.env.SESSION_SECRET || (pw ? crypto.createHash("sha256").update("magpy-session|" + pw).digest("hex") : "") };
};
const SESSION_MS = 30 * 24 * 3600 * 1000, COOKIE = "magpy_session";
const hmac = (v) => crypto.createHmac("sha256", cfg().secret).update(v).digest("base64url");
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(), crypto.createHash("sha256").update(String(b)).digest());
const makeSession = () => { const exp = String(Date.now() + SESSION_MS); return exp + "." + hmac("v1." + exp); };
function hasSession(req) {
  const m = /(?:^|;\s*)magpy_session=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return false;
  const [exp, sig] = m[1].split("."); if (!exp || !sig || !(+exp > Date.now())) return false;
  const want = hmac("v1." + exp); return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const cookie = (req, val, maxAge) => `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
// Best-effort per-instance brute-force limiter (serverless instances don't share memory).
const fails = new Map(); const FAIL_MAX = 5, FAIL_WIN = 10 * 60 * 1000;
const ipOf = (req) => String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch { throw new Error("bad json"); } }
    if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8") || "{}"); } catch { throw new Error("bad json"); } }
    return req.body;
  }
  let b = ""; for await (const c of req) { b += c; if (b.length > 1e6) throw new Error("big"); }
  try { return JSON.parse(b || "{}"); } catch { throw new Error("bad json"); }
}
const send = (res, code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(obj)); };
const reply = (res, r) => send(res, r.code, r.body);

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x"), p = url.pathname.replace(/\/+$/, "") || "/", by = String(req.headers["x-user"] || ""), M = req.method;
    const { pw } = cfg();
    if (p === "/api/session" && M === "GET") return send(res, 200, { required: !!pw, ok: !pw || hasSession(req) });
    if (p === "/api/login" && M === "POST") {
      if (!pw) return send(res, 200, { ok: true, required: false });
      const ip = ipOf(req), t = Date.now(); let f = fails.get(ip);
      if (f && t - f.first > FAIL_WIN) { fails.delete(ip); f = null; }
      if (f && f.n >= FAIL_MAX) { res.setHeader("retry-after", Math.ceil((f.first + FAIL_WIN - t) / 1000)); return send(res, 429, { error: "Too many attempts. Try again in a few minutes." }); }
      const b = await readBody(req);
      if (typeof b.password === "string" && safeEq(b.password, pw)) { fails.delete(ip); res.setHeader("set-cookie", cookie(req, makeSession(), SESSION_MS / 1000)); return send(res, 200, { ok: true }); }
      const n = fails.get(ip) || { n: 0, first: t }; n.n++; fails.set(ip, n);
      await new Promise((r) => setTimeout(r, 400));
      return send(res, 401, { error: "That password didn't match." });
    }
    if (p === "/api/logout" && M === "POST") { res.setHeader("set-cookie", cookie(req, "", 0)); return send(res, 200, { ok: true }); }
    if (!p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (pw && !hasSession(req)) return send(res, 401, { error: "login required" });

    if (p === "/api/events") return send(res, 410, { error: "SSE not available on Vercel; poll /api/data?since=<rev>" });
    if (p === "/api/data" && M === "GET") {
      const { rev, db } = await readState(), since = url.searchParams.get("since");
      if (since !== null && since !== "" && +since === rev) return send(res, 200, { rev, unchanged: true });
      return send(res, 200, view(db, rev));
    }
    if (p === "/api/task" && M === "PUT") {
      const t = await readBody(req); if (!t.id || typeof t.title !== "string") return send(res, 400, { error: "bad task" });
      t.updatedAt = +t.updatedAt || Date.now();
      return reply(res, await mutate((db) => {
        const i = db.tasks.findIndex((x) => x.id === t.id), cur = db.tasks[i];
        if ((cur && cur.updatedAt > t.updatedAt) || (db.tombstones[t.id] || 0) > t.updatedAt) return { code: 200, body: { applied: false, task: cur || null } };
        const nt = { id: t.id, updatedAt: t.updatedAt }; for (const k of FIELDS) nt[k] = String(t[k] ?? ""); nt.priority = normPri(nt.priority);
        nt.docs = cleanDocs(t.docs === undefined ? (cur && cur.docs) : t.docs, cur && cur.docs, by);
        logTaskChange(db, by, cur, nt); logDocs(db, by, cur, nt); i >= 0 ? (db.tasks[i] = nt) : db.tasks.push(nt); delete db.tombstones[t.id];
        return { code: 200, body: { applied: true, task: nt }, write: true };
      }));
    }
    if (p.startsWith("/api/task/") && M === "DELETE") {
      const id = decodeURIComponent(p.slice(10)), at = +url.searchParams.get("updatedAt") || Date.now();
      return reply(res, await mutate((db) => {
        const cur = db.tasks.find((x) => x.id === id);
        if (cur && cur.updatedAt > at) return { code: 200, body: { applied: false } };
        if (cur) log(db, by, "deleted", cur, "deleted this task");
        db.tasks = db.tasks.filter((x) => x.id !== id); delete db.comments[id]; db.tombstones[id] = at;
        return { code: 200, body: { applied: true }, write: true };
      }));
    }
    const cm = p.match(/^\/api\/task\/([^/]+)\/comments$/);
    if (cm && M === "POST") {
      const id = decodeURIComponent(cm[1]), b = await readBody(req), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(res, 400, { error: "text required" }); if (text.length > 2000) return send(res, 400, { error: "comment too long (max 2000)" });
      return reply(res, await mutate((db) => {
        const task = db.tasks.find((x) => x.id === id); if (!task) return { code: 404, body: { error: "no such task" } };
        const c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), author: String(b.author || by || "Someone").slice(0, 40), text, at: new Date().toISOString() };
        (db.comments[id] ||= []).push(c); log(db, c.author, "comment", task, "commented: " + (text.length > 90 ? text.slice(0, 90) + "…" : text));
        return { code: 201, body: { comment: c }, write: true };
      }));
    }
    if (p === "/api/hours" && M === "PUT") {
      const { key, value, updatedAt } = await readBody(req), at = +updatedAt || Date.now();
      if (!key || !isFinite(+value)) return send(res, 400, { error: "bad hours" });
      return reply(res, await mutate((db) => {
        if (db.hours[key] && db.hours[key].updatedAt > at) return { code: 200, body: { applied: false } };
        db.hours[key] = { value: +value, updatedAt: at }; return { code: 200, body: { applied: true }, write: true };
      }));
    }
    if (p === "/api/meetings" && M === "GET") return send(res, 200, { meetings: (await readState()).db.meetings });
    if (p === "/api/meetings" && M === "POST") {
      const b = await readBody(req);
      return reply(res, await mutate((db) => {
        const r = cleanMeeting(b, null, by); if (r.error) return { code: 400, body: r };
        db.meetings.push(touch(r.m)); log(db, by || r.m.createdBy, "meeting", { id: "", title: r.m.title }, "requested a meeting on " + r.m.start.slice(0, 10));
        return { code: 201, body: { meeting: r.m }, write: true };
      }));
    }
    if (p === "/api/meetings/pending" && M === "GET") {
      const inc = url.searchParams.get("include") === "cancelled", { db } = await readState();
      return send(res, 200, { meetings: db.meetings.filter((m) => m.status === "requested" || (inc && m.status === "cancelled" && m.googleEventId)) });
    }
    const mm = p.match(/^\/api\/meetings\/([^/]+)(\/synced)?$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]), synced = !!mm[2];
      if (!synced && M === "GET") { const cur = (await readState()).db.meetings.find((x) => x.id === id); return cur ? send(res, 200, { meeting: cur }) : send(res, 404, { error: "no such meeting" }); }
      const b = M === "DELETE" ? {} : await readBody(req), hard = url.searchParams.get("hard") === "1";
      if ((synced && M === "POST") || (!synced && (M === "PUT" || M === "DELETE")))
        return reply(res, await mutate((db) => {
          const i = db.meetings.findIndex((x) => x.id === id), cur = db.meetings[i];
          if (!cur) return { code: 404, body: { error: "no such meeting" } };
          if (synced) {
            cur.googleEventId = b.googleEventId ?? null;
            if (b.meetLink !== undefined) cur.meetLink = b.meetLink || null;
            if (cur.status !== "cancelled") cur.status = "on calendar";
            touch(cur); return { code: 200, body: { meeting: cur }, write: true };
          }
          if (M === "PUT") {
            const r = cleanMeeting(b, cur, by); if (r.error) return { code: 400, body: r };
            r.m.status = MSTAT.includes(b.status) ? b.status : "requested";
            db.meetings[i] = touch(r.m); return { code: 200, body: { meeting: r.m }, write: true };
          }
          if (hard) db.meetings.splice(i, 1); else { cur.status = "cancelled"; touch(cur); }
          return { code: 200, body: { ok: true, meeting: hard ? null : cur }, write: true };
        }));
    }
    if (p === "/api/asks" && M === "GET") return send(res, 200, { asks: (await readState()).db.asks });
    if (p === "/api/asks" && M === "POST") {
      const b = await readBody(req), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(res, 400, { error: "text required" }); if (text.length > 2000) return send(res, 400, { error: "text too long (max 2000)" });
      return reply(res, await mutate((db) => {
        const a = { id: aid(), text, createdBy: String(b.createdBy || by || "").slice(0, 40), createdAt: new Date().toISOString(), status: "new", reply: null, repliedAt: null };
        db.asks.push(a); return { code: 201, body: { ask: a }, write: true };
      }));
    }
    if (p === "/api/asks/pending" && M === "GET") return send(res, 200, { asks: (await readState()).db.asks.filter((a) => a.status === "new") });
    const am = p.match(/^\/api\/asks\/([^/]+)\/reply$/);
    if (am && M === "POST") {
      const id = decodeURIComponent(am[1]), b = await readBody(req);
      return reply(res, await mutate((db) => {
        const a = db.asks.find((x) => x.id === id); if (!a) return { code: 404, body: { error: "no such ask" } };
        if (typeof b.reply !== "string" || !b.reply.trim()) return { code: 400, body: { error: "reply required" } };
        a.reply = b.reply.trim(); a.status = "handled"; a.repliedAt = new Date().toISOString(); return { code: 200, body: { ask: a }, write: true };
      }));
    }
    if (p === "/api/reset" && M === "POST") {
      return reply(res, await mutate((db) => {
        const f = emptyDb(); f.asks = db.asks; Object.keys(db).forEach((k) => delete db[k]); Object.assign(db, f);
        return { code: 200, body: { ok: true }, write: true };
      }));
    }
    return send(res, 404, { error: "not found" });
  } catch (e) { return send(res, 500, { error: String((e && e.message) || e) }); }
}
module.exports = { handler, mutate, readState };
