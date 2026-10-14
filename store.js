(function () {
  const KEY = "magpy-dashboard-v1", UKEY = "magpy-user";
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isDemo = () => /demo/i.test(location.hash);
  const seed = () => {
    const mk = (title, priority) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "" });
    return {
      tasks: [
        mk("Natrion source list", "High"), mk("Natrion memo onto the template", "Medium"),
        mk("Natrion sonar", "Medium"), mk("Natrion growth drivers", "Medium"),
        mk("KairosLive facts file", "Medium"), mk("Robotaxi primer", "Medium"),
        mk("SAFE math explainer", "Low"), mk("Deal Evidence File blank template", "Low"),
      ],
      hours: {},
    };
  };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const write = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const local = {
    async load() { let d = read(); if (!d) { d = seed(); write(d); } return d; },
    async saveTask(t) { const d = await this.load(); if (!t.id) t.id = uid(); const i = d.tasks.findIndex((x) => x.id === t.id); i >= 0 ? (d.tasks[i] = t) : d.tasks.push(t); write(d); return t; },
    async deleteTask(id) { const d = await this.load(); d.tasks = d.tasks.filter((t) => t.id !== id); write(d); },
    async setHours(p, w, h) { const d = await this.load(); d.hours[p + "|" + w] = h; write(d); },
    async reset() { localStorage.removeItem(KEY); },
    async saveMeeting(m) { const d = await this.load(); d.meetings ||= []; if (!m.id) { m.id = "m" + uid(); m.status = "requested"; m.googleEventId = null; } const i = d.meetings.findIndex((x) => x.id === m.id); i >= 0 ? (d.meetings[i] = m) : d.meetings.push(m); write(d); return m; },
    async addComment(id, text) { const d = await this.load(); const c = { id: "c" + uid(), author: Store.user() || "Ariel", text, at: new Date().toISOString() }; ((d.comments ||= {})[id] ||= []).push(c); write(d); return c; },
    async sendAsk(text) { return null; },
    async cancelMeeting(id) { const d = await this.load(); const m = (d.meetings || []).find((x) => x.id === id); if (m) { m.status = "cancelled"; write(d); } },
  };

  const subs = new Set(); let online = true, saving = 0, es = null, lastClock = 0;
  const emit = (type) => subs.forEach((f) => { try { f({ type, online, saving: saving > 0 }); } catch (e) { console.error(e); } });
  const now = () => (lastClock = Math.max(Date.now(), lastClock + 1));
  const setOnline = (v) => { if (online !== v) { online = v; emit("status"); } };
  const authLost = () => window.dispatchEvent(new Event("magpy-auth"));
  async function api(method, url, body) {
    saving++; emit("status");
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json", "x-user": Store.user() }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401) authLost();
      if (!r.ok) throw new Error("HTTP " + r.status);
      setOnline(true); return await r.json();
    } catch (e) { setOnline(false); throw e; }
    finally { saving--; emit("status"); }
  }
  function connect() {
    if (es || isDemo() || !window.EventSource) return;
    es = new EventSource("/api/events");
    es.onopen = () => { setOnline(true); emit("change"); }; // resync after (re)connect
    es.addEventListener("change", () => emit("change"));
    es.onerror = () => { setOnline(false); if (es.readyState === 2) { es = null; setTimeout(() => { if (!document.hidden || true) connect(); }, 4000); } }; // EventSource retries by itself unless the server refused (e.g. 401)
  }
  const remote = {
    async load() { const r = await fetch("/api/data", { cache: "no-store" }).catch((e) => { setOnline(false); throw e; }); if (r.status === 401) authLost(); if (!r.ok) { setOnline(false); throw new Error("HTTP " + r.status); } setOnline(true); return r.json(); },
    async addComment(id, text) { const r = await api("POST", "/api/task/" + encodeURIComponent(id) + "/comments", { text, author: Store.user() }); return r.comment; },
    async saveTask(t) { if (!t.id) t.id = uid(); t.updatedAt = now(); const r = await api("PUT", "/api/task", t); if (r.task) Object.assign(t, r.task); return t; },
    async deleteTask(id) { await api("DELETE", "/api/task/" + encodeURIComponent(id) + "?updatedAt=" + now()); },
    async setHours(p, w, h) { await api("PUT", "/api/hours", { key: p + "|" + w, value: h, updatedAt: now() }); },
    async reset() { await api("POST", "/api/reset"); },
    async saveMeeting(m) { const r = m.id ? await api("PUT", "/api/meetings/" + encodeURIComponent(m.id), m) : await api("POST", "/api/meetings", { ...m, createdBy: Store.user() }); return r.meeting; },
    async sendAsk(text) { const r = await api("POST", "/api/asks", { text, createdBy: Store.user() }); return r.ask; },
    async cancelMeeting(id) { await api("DELETE", "/api/meetings/" + encodeURIComponent(id)); },
  };
  const be = () => (isDemo() ? local : remote);
  window.Store = {
    load: () => be().load(), saveTask: (t) => be().saveTask(t), deleteTask: (id) => be().deleteTask(id),
    setHours: (p, w, h) => be().setHours(p, w, h), saveMeeting: (m) => be().saveMeeting(m), cancelMeeting: (id) => be().cancelMeeting(id), sendAsk: (t) => be().sendAsk(t), addComment: (id, t) => be().addComment(id, t),
    async session() { try { const r = await fetch("/api/session", { cache: "no-store" }); return r.ok ? await r.json() : { required: false, ok: true }; } catch { return { required: false, ok: true }; } },
    async login(password) { const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Could not sign in."); return j; },
    async logout() { await fetch("/api/logout", { method: "POST" }); }, reset: () => be().reset(),
    reconnect: () => { if (es && es.readyState !== 2) return; es = null; connect(); },
    subscribe(fn) { subs.add(fn); connect(); return () => subs.delete(fn); },
    user: () => localStorage.getItem(UKEY) || "",
    setUser: (u) => localStorage.setItem(UKEY, u),
    status: () => ({ online, saving: saving > 0, demo: isDemo() }),
  };
})();
