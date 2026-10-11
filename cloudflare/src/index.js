// Magpy dashboard on Cloudflare Workers: static assets + /api/* routed to one SQLite-backed Durable Object.
import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      // Pass current secrets per request: the DO's own env is frozen at construction.
      const h = new Headers(request.headers);
      h.set("x-cfg-pw", env.APP_PASSWORD || ""); h.set("x-cfg-ss", env.SESSION_SECRET || "");
      return env.DASHBOARD.get(env.DASHBOARD.idFromName("main")).fetch(new Request(request, { headers: h }));
    }
    return env.ASSETS.fetch(request);
  },
};

const enc = new TextEncoder();
const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const PRIS = ["Urgent", "High", "Medium", "Low"];
const normPri = (v) => PRIS.find((p) => p.toLowerCase() === String(v ?? "").trim().toLowerCase()) || "Low";
const seedTasks = () => {
  const now = Date.now(), mk = (title, priority, i) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "", updatedAt: now + i });
  return ["Natrion source list|High", "Natrion memo onto the template|Medium", "Natrion sonar|Medium", "Natrion growth drivers|Medium",
    "KairosLive facts file|Medium", "Robotaxi primer|Medium", "SAFE math explainer|Low", "Deal Evidence File blank template|Low"]
    .map((s, i) => mk(...s.split("|"), i));
};
const MSTAT = ["requested", "on calendar", "cancelled"], RMIN = [0, 10, 60, 1440];
const mid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const aid = () => "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const actId = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isoOk = (s) => typeof s === "string" && !isNaN(Date.parse(s));
const touch = (m) => { m.updatedAt = Date.now(); return m; };
const FIELDS = ["title", "status", "owner", "due", "priority", "area", "notes"];
const LBL = { status: "status", priority: "priority", owner: "owner", due: "due date" };
const SESSION_MS = 30 * 24 * 3600 * 1000, COOKIE = "magpy_session", FAIL_MAX = 5, FAIL_WIN = 10 * 60 * 1000;

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

// ---- Web Crypto helpers
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s)))); }
async function safeEq(a, b) { const x = await sha256(a), y = await sha256(b); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; }
async function hmac(secret, v) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(v)));
}

export class Dashboard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.clients = new Set(); this.fails = new Map(); this.dirty = new Set(); this.ready = null; this.timer = null;
  }

  // ---- storage: whole state lives in memory, persisted per-section in DO (SQLite) key-value storage.
  async load() {
    const s = this.ctx.storage, g = async (k, d) => (await s.get(k)) ?? d;
    const db = { tasks: await g("tasks", null), hours: await g("hours", {}), tombstones: await g("tombstones", {}), meetings: await g("meetings", []), asks: await g("asks", []), activity: await g("activity", []), comments: {} };
    for (const [k, v] of await s.list({ prefix: "c:" })) db.comments[k.slice(2)] = v;
    this.db = db;
    if (!Array.isArray(db.tasks)) { db.tasks = seedTasks(); this.mark("tasks", "hours", "tombstones", "meetings", "asks", "activity"); await this.flush(); }
  }
  init() { return (this.ready ||= this.load()); }
  mark(...secs) { for (const x of secs) this.dirty.add(x); }
  async flush() {
    const s = this.ctx.storage, db = this.db, out = {};
    for (const k of this.dirty) {
      if (k.startsWith("c:")) { const id = k.slice(2); if (db.comments[id]) out[k] = db.comments[id]; else await s.delete(k); }
      else out[k] = db[k];
    }
    this.dirty.clear(); if (Object.keys(out).length) await s.put(out);
  }
  view() { const db = this.db; return { tasks: db.tasks, meetings: db.meetings, asks: db.asks, comments: db.comments, activity: db.activity.slice(-150).reverse(), hours: Object.fromEntries(Object.entries(db.hours).map(([k, v]) => [k, v.value])) }; }
  log(by, kind, task, text) {
    const a = this.db.activity;
    a.push({ id: actId(), at: new Date().toISOString(), who: String(by || "").slice(0, 40), kind, taskId: task ? task.id : "", title: task ? task.title : "", text: String(text || "").slice(0, 200) });
    if (a.length > 500) this.db.activity = a.slice(-500);
    this.mark("activity");
  }
  logTaskChange(by, cur, nt) {
    if (!cur) return this.log(by, "created", nt, "created this task");
    for (const k of ["status", "priority", "owner", "due"]) if ((cur[k] || "") !== (nt[k] || "")) this.log(by, "change", nt, `changed ${LBL[k]}: ${cur[k] || "none"} → ${nt[k] || "none"}`);
    if (cur.title !== nt.title) this.log(by, "change", nt, `renamed from “${cur.title}”`);
  }

  // ---- SSE (held open by the DO; pings keep proxies from idling the stream)
  broadcast(by) {
    const m = enc.encode(`event: change\ndata: ${JSON.stringify({ by: by || "", t: Date.now() })}\n\n`);
    for (const c of [...this.clients]) c.write(m).catch(() => this.clients.delete(c));
  }
  sse(request) {
    const { readable, writable } = new TransformStream(), w = writable.getWriter();
    this.clients.add(w);
    const drop = () => { this.clients.delete(w); w.close().catch(() => {}); if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = null; } };
    request.signal.addEventListener("abort", drop); w.closed.catch(() => {}).then(drop);
    w.write(enc.encode("retry: 1000\n\n"));
    if (!this.timer) this.timer = setInterval(() => { const p = enc.encode(": ping\n\n"); for (const c of [...this.clients]) c.write(p).catch(() => this.clients.delete(c)); }, 15000);
    return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }

  // ---- auth
  get password() { return this._pw || ""; }
  secretP() { return this._ss || (this.password ? "magpy-session|" + this.password : ""); }
  async makeSession() { const exp = String(Date.now() + SESSION_MS); return exp + "." + (await hmac(this.secretP(), "v1." + exp)); }
  async hasSession(request) {
    const m = /(?:^|;\s*)magpy_session=([^;]+)/.exec(request.headers.get("cookie") || ""); if (!m) return false;
    const [exp, sig] = m[1].split("."); if (!exp || !sig || !(+exp > Date.now())) return false;
    return safeEq(sig, await hmac(this.secretP(), "v1." + exp));
  }
  cookie(url, val, maxAge) { return `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`; }

  async fetch(request) {
    await this.init();
    this._pw = request.headers.get("x-cfg-pw") || ""; this._ss = request.headers.get("x-cfg-ss") || "";
    try { return await this.route(request); } catch (e) { return this.json(500, { error: String(e.message || e) }); }
  }
  json(code, obj, headers) { return new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } }); }
  async body(request) {
    const t = await request.text(); if (t.length > 1e6) throw new Error("big");
    return JSON.parse(t || "{}");
  }
  async done(by, code, obj) { await this.flush(); this.broadcast(by); return this.json(code, obj); }

  async route(request) {
    const url = new URL(request.url), p = url.pathname, by = request.headers.get("x-user") || "", M = request.method, db = this.db;
    const send = (c, o, h) => this.json(c, o, h);
    if (p === "/api/session" && M === "GET") return send(200, { required: !!this.password, ok: !this.password || await this.hasSession(request) });
    if (p === "/api/login" && M === "POST") {
      if (!this.password) return send(200, { ok: true, required: false });
      const ip = request.headers.get("cf-connecting-ip") || "", t = Date.now(), f = this.fails.get(ip);
      if (f && t - f.first > FAIL_WIN) this.fails.delete(ip);
      const cf = this.fails.get(ip);
      if (cf && cf.n >= FAIL_MAX) return send(429, { error: "Too many attempts. Try again in a few minutes." }, { "retry-after": String(Math.ceil((cf.first + FAIL_WIN - t) / 1000)) });
      const b = await this.body(request);
      if (typeof b.password === "string" && (await safeEq(b.password, this.password))) {
        this.fails.delete(ip); return send(200, { ok: true }, { "set-cookie": this.cookie(url, await this.makeSession(), SESSION_MS / 1000) });
      }
      const n = this.fails.get(ip) || { n: 0, first: t }; n.n++; this.fails.set(ip, n);
      await new Promise((r) => setTimeout(r, 400));
      return send(401, { error: "That password didn't match." });
    }
    if (p === "/api/logout" && M === "POST") return send(200, { ok: true }, { "set-cookie": this.cookie(url, "", 0) });
    if (this.password && !(await this.hasSession(request))) return send(401, { error: "login required" });
    if (p === "/api/events") return this.sse(request);
    if (p === "/api/data" && M === "GET") return send(200, this.view());

    if (p === "/api/task" && M === "PUT") {
      const t = await this.body(request); if (!t.id || typeof t.title !== "string") return send(400, { error: "bad task" });
      t.updatedAt = +t.updatedAt || Date.now();
      const i = db.tasks.findIndex((x) => x.id === t.id), cur = db.tasks[i];
      if ((cur && cur.updatedAt > t.updatedAt) || (db.tombstones[t.id] || 0) > t.updatedAt) return send(200, { applied: false, task: cur || null });
      const nt = { id: t.id, updatedAt: t.updatedAt }; for (const k of FIELDS) nt[k] = String(t[k] ?? ""); nt.priority = normPri(nt.priority);
      this.logTaskChange(by, cur, nt); i >= 0 ? (db.tasks[i] = nt) : db.tasks.push(nt); delete db.tombstones[t.id];
      this.mark("tasks", "tombstones"); return this.done(by, 200, { applied: true, task: nt });
    }
    if (p.startsWith("/api/task/") && M === "DELETE") {
      const id = decodeURIComponent(p.slice(10)), at = +url.searchParams.get("updatedAt") || Date.now(), cur = db.tasks.find((x) => x.id === id);
      if (cur && cur.updatedAt > at) return send(200, { applied: false });
      if (cur) this.log(by, "deleted", cur, "deleted this task");
      db.tasks = db.tasks.filter((x) => x.id !== id); delete db.comments[id]; db.tombstones[id] = at; this.mark("tasks", "tombstones", "c:" + id);
      return this.done(by, 200, { applied: true });
    }
    const cm = p.match(/^\/api\/task\/([^/]+)\/comments$/);
    if (cm && M === "POST") {
      const id = decodeURIComponent(cm[1]), task = db.tasks.find((x) => x.id === id); if (!task) return send(404, { error: "no such task" });
      const b = await this.body(request), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(400, { error: "text required" }); if (text.length > 2000) return send(400, { error: "comment too long (max 2000)" });
      const c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), author: String(b.author || by || "Someone").slice(0, 40), text, at: new Date().toISOString() };
      (db.comments[id] ||= []).push(c); this.log(c.author, "comment", task, "commented: " + (text.length > 90 ? text.slice(0, 90) + "…" : text));
      this.mark("c:" + id); return this.done(by, 201, { comment: c });
    }
    if (p === "/api/hours" && M === "PUT") {
      const { key, value, updatedAt } = await this.body(request), at = +updatedAt || Date.now();
      if (!key || !isFinite(+value)) return send(400, { error: "bad hours" });
      if (db.hours[key] && db.hours[key].updatedAt > at) return send(200, { applied: false });
      db.hours[key] = { value: +value, updatedAt: at }; this.mark("hours"); return this.done(by, 200, { applied: true });
    }

    if (p === "/api/meetings" && M === "GET") return send(200, { meetings: db.meetings });
    if (p === "/api/meetings" && M === "POST") {
      const r = cleanMeeting(await this.body(request), null, by); if (r.error) return send(400, r);
      db.meetings.push(touch(r.m)); this.log(by || r.m.createdBy, "meeting", { id: "", title: r.m.title }, "requested a meeting on " + r.m.start.slice(0, 10));
      this.mark("meetings"); return this.done(by, 201, { meeting: r.m });
    }
    if (p === "/api/meetings/pending" && M === "GET") {
      const inc = url.searchParams.get("include") === "cancelled";
      return send(200, { meetings: db.meetings.filter((m) => m.status === "requested" || (inc && m.status === "cancelled" && m.googleEventId)) });
    }
    const mm = p.match(/^\/api\/meetings\/([^/]+)(\/synced)?$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]), i = db.meetings.findIndex((x) => x.id === id), cur = db.meetings[i];
      if (!cur) return send(404, { error: "no such meeting" });
      if (mm[2] && M === "POST") {
        const b = await this.body(request); cur.googleEventId = b.googleEventId ?? null;
        if (b.meetLink !== undefined) cur.meetLink = b.meetLink || null;
        if (cur.status !== "cancelled") cur.status = "on calendar";
        touch(cur); this.mark("meetings"); return this.done(by, 200, { meeting: cur });
      }
      if (!mm[2] && M === "GET") return send(200, { meeting: cur });
      if (!mm[2] && M === "PUT") {
        const b = await this.body(request), r = cleanMeeting(b, cur, by); if (r.error) return send(400, r);
        r.m.status = MSTAT.includes(b.status) ? b.status : "requested";
        db.meetings[i] = touch(r.m); this.mark("meetings"); return this.done(by, 200, { meeting: r.m });
      }
      if (!mm[2] && M === "DELETE") {
        const hard = url.searchParams.get("hard") === "1";
        if (hard) db.meetings.splice(i, 1); else { cur.status = "cancelled"; touch(cur); }
        this.mark("meetings"); return this.done(by, 200, { ok: true, meeting: hard ? null : cur });
      }
    }

    if (p === "/api/asks" && M === "GET") return send(200, { asks: db.asks });
    if (p === "/api/asks" && M === "POST") {
      const b = await this.body(request), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return send(400, { error: "text required" }); if (text.length > 2000) return send(400, { error: "text too long (max 2000)" });
      const a = { id: aid(), text, createdBy: String(b.createdBy || by || "").slice(0, 40), createdAt: new Date().toISOString(), status: "new", reply: null, repliedAt: null };
      db.asks.push(a); this.mark("asks"); return this.done(by, 201, { ask: a });
    }
    if (p === "/api/asks/pending" && M === "GET") return send(200, { asks: db.asks.filter((a) => a.status === "new") });
    const am = p.match(/^\/api\/asks\/([^/]+)\/reply$/);
    if (am && M === "POST") {
      const a = db.asks.find((x) => x.id === decodeURIComponent(am[1])); if (!a) return send(404, { error: "no such ask" });
      const b = await this.body(request); if (typeof b.reply !== "string" || !b.reply.trim()) return send(400, { error: "reply required" });
      a.reply = b.reply.trim(); a.status = "handled"; a.repliedAt = new Date().toISOString(); this.mark("asks"); return this.done(by, 200, { ask: a });
    }
    if (p === "/api/reset" && M === "POST") {
      const oldC = Object.keys(db.comments);
      this.db = { tasks: seedTasks(), hours: {}, tombstones: {}, meetings: [], asks: db.asks, comments: {}, activity: [] };
      this.mark("tasks", "hours", "tombstones", "meetings", "asks", "activity", ...oldC.map((k) => "c:" + k)); return this.done(by, 200, { ok: true });
    }
    return send(404, { error: "not found" });
  }
}
