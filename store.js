// Data layer. Server mode (default) talks to /api with SSE sync; "#demo" in the URL uses localStorage only.
// Contract: all methods async. load() -> {tasks, hours}; saveTask(task); deleteTask(id); setHours(person, weekStart, hours); reset();
// Extras: subscribe(fn) -> fn({type:"change"|"status", online, saving}); user get/set.
(function () {
  const KEY = "magpy-dashboard-v1", UKEY = "magpy-user";
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isDemo = () => /demo/i.test(location.hash);
  const seed = () => {
    const mk = (title, priority) => ({ id: uid(), title, status: "Open", owner: "Unassigned", due: "", priority, area: "Magpy", notes: "" });
    return {
      tasks: [
        mk("Natrion source list", "High"), mk("Natrion memo onto the template", "High"),
        mk("Natrion sonar", "High"), mk("Natrion growth drivers", "High"),
        mk("KairosLive facts file", "High"), mk("Robotaxi primer", "High"),
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
  };

  const subs = new Set(); let online = true, saving = 0, es = null, lastClock = 0;
  const emit = (type) => subs.forEach((f) => { try { f({ type, online, saving: saving > 0 }); } catch (e) { console.error(e); } });
  const now = () => (lastClock = Math.max(Date.now(), lastClock + 1));
  const setOnline = (v) => { if (online !== v) { online = v; emit("status"); } };
  async function api(method, url, body) {
    saving++; emit("status");
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json", "x-user": Store.user() }, body: body ? JSON.stringify(body) : undefined });
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
    es.onerror = () => setOnline(false); // EventSource retries automatically
  }
  const remote = {
    async load() { const r = await fetch("/api/data", { cache: "no-store" }).catch((e) => { setOnline(false); throw e; }); if (!r.ok) { setOnline(false); throw new Error("HTTP " + r.status); } setOnline(true); return r.json(); },
    async saveTask(t) { if (!t.id) t.id = uid(); t.updatedAt = now(); const r = await api("PUT", "/api/task", t); if (r.task) Object.assign(t, r.task); return t; },
    async deleteTask(id) { await api("DELETE", "/api/task/" + encodeURIComponent(id) + "?updatedAt=" + now()); },
    async setHours(p, w, h) { await api("PUT", "/api/hours", { key: p + "|" + w, value: h, updatedAt: now() }); },
    async reset() { await api("POST", "/api/reset"); },
  };
  const be = () => (isDemo() ? local : remote);
  window.Store = {
    load: () => be().load(), saveTask: (t) => be().saveTask(t), deleteTask: (id) => be().deleteTask(id),
    setHours: (p, w, h) => be().setHours(p, w, h), reset: () => be().reset(),
    subscribe(fn) { subs.add(fn); connect(); return () => subs.delete(fn); },
    user: () => localStorage.getItem(UKEY) || "",
    setUser: (u) => localStorage.setItem(UKEY, u),
    status: () => ({ online, saving: saving > 0, demo: isDemo() }),
  };
})();
