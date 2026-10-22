(function () {
  const UKEY = "solavant-privates-user";
  const API = "/api/privates";
  const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const subs = new Set(); let online = true, saving = 0, lastClock = 0;
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
  let rev = null, timer = null, polling = false, authBlocked = false;
  const delay = () => (document.hidden ? 10000 : 2000);
  async function poll() {
    timer = null;
    if (authBlocked) return;
    try {
      const r = await fetch(API + "/data?since=" + (rev == null ? "" : rev), { cache: "no-store" });
      if (r.status === 401) { authBlocked = true; setOnline(false); authLost(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); const was = online; setOnline(true);
      if (j.rev !== undefined && j.rev !== rev) { const first = rev == null; rev = j.rev; if (!j.unchanged && (!first || was === false)) emit("change"); }
    } catch { setOnline(false); }
    if (polling) timer = setTimeout(poll, delay());
  }
  function connect() {
    if (polling) return;
    polling = true; poll();
  }
  document.addEventListener("visibilitychange", () => { if (polling && !authBlocked) { clearTimeout(timer); timer = setTimeout(poll, document.hidden ? delay() : 0); } });
  window.Store = {
    async load() {
      const r = await fetch(API + "/data", { cache: "no-store" }).catch((e) => { setOnline(false); throw e; });
      if (r.status === 401) authLost();
      if (!r.ok) { setOnline(false); throw new Error("HTTP " + r.status); }
      setOnline(true);
      const j = await r.json();
      if (j.rev !== undefined) rev = j.rev;
      j.tasks ||= []; j.hours ||= {}; j.meetings ||= []; j.asks ||= []; j.comments ||= {}; j.activity ||= [];
      return j;
    },
    async saveTask(t) { if (!t.id) t.id = uid(); t.updatedAt = now(); const r = await api("PUT", API + "/task", t); if (r.task) Object.assign(t, r.task); return t; },
    async deleteTask(id) { await api("DELETE", API + "/task/" + encodeURIComponent(id) + "?updatedAt=" + now()); },
    async setHours(p, w, h) { await api("PUT", API + "/hours", { key: p + "|" + w, value: h, updatedAt: now() }); },
    async reset() { await api("POST", API + "/reset"); },
    async saveMeeting(m) { const r = m.id ? await api("PUT", API + "/meetings/" + encodeURIComponent(m.id), m) : await api("POST", API + "/meetings", { ...m, createdBy: Store.user() }); return r.meeting; },
    async cancelMeeting(id) { await api("DELETE", API + "/meetings/" + encodeURIComponent(id)); },
    async addComment(id, text) { const r = await api("POST", API + "/task/" + encodeURIComponent(id) + "/comments", { text, author: Store.user() }); return r.comment; },
    async sendAsk(text) { const r = await api("POST", API + "/asks", { text, createdBy: Store.user() }); return r.ask; },
    async refreshNotion() { return api("POST", API + "/notion/refresh", {}); },
    async session() { try { const r = await fetch("/api/session", { cache: "no-store" }); return r.ok ? await r.json() : { required: false, ok: true }; } catch { return { required: false, ok: true }; } },
    async login(password) { const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Could not sign in."); return j; },
    async logout() { await fetch("/api/logout", { method: "POST" }); },
    reconnect() { authBlocked = false; clearTimeout(timer); polling = false; connect(); },
    subscribe(fn) { subs.add(fn); connect(); return () => subs.delete(fn); },
    user: () => localStorage.getItem(UKEY) || "",
    setUser: (u) => localStorage.setItem(UKEY, u),
    status: () => ({ online, saving: saving > 0, demo: false }),
  };
})();
