(function () {
  const KEY = "solavant-privates-v1", UKEY = "solavant-privates-user";
  const NOTE = "Placeholder. Not from a database.";
  const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
  const seed = () => {
    const mk = (title, status, owner, priority, dueOff) => ({
      id: uid(), title, status, owner, priority, area: "Private Capital",
      due: dueOff == null ? "" : day(dueOff), notes: NOTE,
    });
    const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(10, 0, 0, 0);
    return {
      tasks: [
        mk("Placeholder: first company screen", "Open", "Unassigned", "Medium", 6),
        mk("Placeholder: investment memo outline", "In Progress", "Ariel", "High", 1),
        mk("Placeholder: data room checklist", "Review", "Can", "Low", null),
      ],
      hours: {},
      meetings: [{
        id: "m" + uid(), title: "Placeholder: partner introduction",
        start: start.toISOString(), end: new Date(+start + 30 * 60000).toISOString(),
        attendees: ["Ariel"], notes: NOTE, meet: false, reminderMinutes: 0, status: "requested", googleEventId: null,
      }],
      asks: [],
      comments: {},
      activity: [{ id: "a" + uid(), who: "Solavant", text: "opened this workspace with sample rows. Nothing here is saved to Magpy or Notion.", title: "Placeholder data", at: new Date().toISOString(), taskId: "" }],
      notion: { configured: false, ok: false, placeholder: true, databaseId: "", error: "", count: 0 },
    };
  };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const write = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const load = async () => { let d = read(); if (!d || !Array.isArray(d.tasks)) { d = seed(); write(d); } d.notion = { configured: false, ok: false, placeholder: true, databaseId: "", error: "", count: d.tasks.length }; return d; };
  const log = (d, text, title, taskId) => { (d.activity ||= []).unshift({ id: "a" + uid(), who: localStorage.getItem(UKEY) || "Someone", text, title: title || "", at: new Date().toISOString(), taskId: taskId || "" }); d.activity = d.activity.slice(0, 60); };
  const subs = new Set();
  const emit = (type) => subs.forEach((f) => { try { f({ type, online: true, saving: false }); } catch (e) { console.error(e); } });
  window.Store = {
    async load() { return load(); },
    async saveTask(t) {
      const d = await load(); if (!t.id) t.id = uid();
      t.area = t.area || "Private Capital";
      const i = d.tasks.findIndex((x) => x.id === t.id);
      log(d, i >= 0 ? "edited a placeholder task" : "added a placeholder task", t.title, t.id);
      i >= 0 ? (d.tasks[i] = t) : d.tasks.push(t);
      write(d); emit("status"); return t;
    },
    async deleteTask(id) { const d = await load(); const t = d.tasks.find((x) => x.id === id); d.tasks = d.tasks.filter((x) => x.id !== id); log(d, "removed a placeholder task", t && t.title, id); write(d); },
    async setHours(p, w, h) { const d = await load(); d.hours[p + "|" + w] = h; log(d, "updated placeholder hours", p); write(d); },
    async reset() { localStorage.removeItem(KEY); },
    async saveMeeting(m) {
      const d = await load(); d.meetings ||= [];
      if (!m.id) { m.id = "m" + uid(); m.status = "requested"; m.googleEventId = null; }
      const i = d.meetings.findIndex((x) => x.id === m.id);
      log(d, i >= 0 ? "edited a placeholder meeting" : "requested a placeholder meeting", m.title);
      i >= 0 ? (d.meetings[i] = m) : d.meetings.push(m);
      write(d); return m;
    },
    async cancelMeeting(id) { const d = await load(); const m = (d.meetings || []).find((x) => x.id === id); if (m) { m.status = "cancelled"; log(d, "cancelled a placeholder meeting", m.title); write(d); } },
    async addComment(id, text) {
      const d = await load();
      const c = { id: "c" + uid(), author: localStorage.getItem(UKEY) || "Ariel", text, at: new Date().toISOString() };
      ((d.comments ||= {})[id] ||= []).push(c);
      const t = d.tasks.find((x) => x.id === id);
      log(d, "commented on a placeholder task", t && t.title, id);
      write(d); return c;
    },
    async sendAsk(text) {
      const d = await load();
      const ask = { id: "k" + uid(), text, createdBy: localStorage.getItem(UKEY) || "Ariel", createdAt: new Date().toISOString(), status: "handled", reply: "Placeholder. No assistant is connected to Solavant Private Capital yet.", repliedAt: new Date().toISOString() };
      (d.asks ||= []).push(ask); log(d, "sent a placeholder request", text.slice(0, 80)); write(d); return ask;
    },
    async refreshNotion() { return { configured: false, placeholder: true }; },
    async session() { try { const r = await fetch("/api/session", { cache: "no-store" }); return r.ok ? await r.json() : { required: false, ok: true }; } catch { return { required: false, ok: true }; } },
    async login(password) { const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Could not sign in."); return j; },
    async logout() { await fetch("/api/logout", { method: "POST" }); },
    reconnect() {},
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    user: () => localStorage.getItem(UKEY) || "",
    setUser: (u) => localStorage.setItem(UKEY, u),
    status: () => ({ online: true, saving: false, demo: false }),
  };
})();
