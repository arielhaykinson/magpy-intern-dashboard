const STATUSES = ["Open", "In Progress", "Review", "Done"];
const OWNERS = ["Myles", "Ariel", "Can", "Unassigned"];
const INTERNS = ["Ariel", "Can"], TARGET = 15;
const SCOLOR = { Open: "var(--s-open)", "In Progress": "var(--s-prog)", Review: "var(--s-rev)", Done: "var(--s-done)" };
const I = (p, c = "ic") => `<svg class="${c}" viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
const ICONS = { caret: '<path d="M4.5 6.5 8 10l3.5-3.5"/>', prev: '<path d="M9.5 4 5.5 8l4 4"/>', next: '<path d="M6.5 4l4 4-4 4"/>', cal: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>', clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>', inbox: '<path d="M2.5 9.5 4 4a1.5 1.5 0 0 1 1.4-1h5.2A1.5 1.5 0 0 1 12 4l1.5 5.5v2a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M2.5 9.5h3l.8 1.5h3.4l.8-1.5h3"/>', list: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>', board: '<rect x="2.5" y="3" width="4" height="10" rx="1.2"/><rect x="9.5" y="3" width="4" height="6" rx="1.2"/>' };
const $ = (s) => document.querySelector(s);
let data = { tasks: [], hours: {}, meetings: [], asks: [] }, tab = "tasks", ownerF = "", selDay = "", demo = false;
const closed = new Set(); const today = new Date(); const iso = (d) => d.toLocaleDateString("en-CA");
const TODAY = iso(today); let cur = new Date(today.getFullYear(), today.getMonth(), 1);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const opts = (a, first) => (first ? `<option value="">${first}</option>` : "") + a.map((x) => `<option>${x}</option>`).join("");
function weekStart(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString("en-CA"); }
const WEEK = weekStart();
const pd = (s) => new Date(s + "T00:00:00");
const fmt = (s) => pd(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const initials = (o) => (o === "Unassigned" ? "?" : o.slice(0, 2).toUpperCase());
const av = (o) => `<span class="own"><i class="av av-${esc(o)}">${initials(o)}</i><span class="oname">${esc(o)}</span></span>`;
const PRIS = ["Urgent", "High", "Medium", "Low"], PR = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const pri = (t) => (PR[t.priority] === undefined ? "Low" : t.priority);
let sortBy = "due";
const byDue = (x, y) => (x.due ? 0 : 1) - (y.due ? 0 : 1) || (x.due || "").localeCompare(y.due || "");
const cmpTasks = (x, y) => sortBy === "priority" ? PR[pri(x)] - PR[pri(y)] || byDue(x, y) : byDue(x, y) || PR[pri(x)] - PR[pri(y)];
const priTag = (t) => `<button type="button" class="pri ${pri(t)}" data-pri="${t.id}" aria-haspopup="menu" title="Change priority">${pri(t)}</button>`;

async function refresh() { data = await Store.load(); if (demo) applyDemo(); render(); }
function filtered() {
  const s = $("#fStatus").value;
  return data.tasks.filter((t) => (!ownerF || t.owner === ownerF) && (!s || t.status === s) && (!$("#fPri").value || pri(t) === $("#fPri").value)).sort(cmpTasks);
}
function dueChip(t) {
  if (!t.due) return "";
  const diff = Math.round((pd(t.due) - pd(TODAY)) / 864e5), done = t.status === "Done";
  const cls = done ? "" : diff < 0 ? "over" : diff <= 2 ? "soon" : "";
  const lbl = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : fmt(t.due);
  return `<span class="due ${cls}">${done ? "" : diff < 0 ? "Overdue · " : ""}${lbl}</span>`;
}
function row(t) {
  return `<div class="row ${t.status === "Done" ? "done" : ""}" data-id="${t.id}">
  <input type="checkbox" class="cb" data-chk="${t.id}" ${t.status === "Done" ? "checked" : ""} aria-label="Mark done">
  <div style="min-width:0"><div class="title">${esc(t.title)}</div><div class="sub">${esc(t.area)}</div></div>
  <div class="meta">${dueChip(t)}<span class="status st-${t.status.replace(/ /g,"")}">${t.status}</span>${priTag(t)}${av(t.owner)}</div></div>`;
}
function renderList(list) {
  $("#list").innerHTML = STATUSES.map((s) => {
    const ts = list.filter((t) => t.status === s);
    return `<div class="group ${closed.has(s) ? "closed" : ""}" data-g="${s}"><div class="ghead"><h2>${s}</h2><span class="count">${ts.length}</span></div>
    <div class="rows">${ts.map(row).join("") || `<div class="empty">Nothing here yet</div>`}</div></div>`;
  }).join("");
}
function upNext() {
  const ts = data.tasks.filter((t) => t.status !== "Done" && (!ownerF || t.owner === ownerF))
    .sort((x, y) => byDue(x, y) || PR[pri(x)] - PR[pri(y)]).slice(0, 5);
  $("#upnext").innerHTML = `<div class="uhead"><h2>Up next</h2><span class="ornament">A few things to look at first</span></div>` + (ts.map((t) =>
    `<div class="row" data-id="${t.id}"><input type="checkbox" class="cb" data-chk="${t.id}" aria-label="Mark done">
    <div class="title">${esc(t.title)}</div><div class="meta">${dueChip(t) || '<span class="due">No date</span>'}${priTag(t)}${av(t.owner)}</div></div>`).join("")
    || `<div class="empty">All clear. Enjoy the quiet.</div>`);
}
function renderBoard(list) {
  $("#board").innerHTML = STATUSES.map((s) => {
    const ts = list.filter((t) => t.status === s);
    return `<div class="col" data-status="${s}"><h2>${s}<span>${ts.length}</span></h2>${ts.map((t) =>
      `<div class="kcard" draggable="true" data-id="${t.id}"><b>${esc(t.title)}</b><div class="meta"><span class="pri ${pri(t)}">${pri(t)}</span>${dueChip(t)}${av(t.owner)}</div></div>`).join("")}</div>`;
  }).join("");
}
function renderCal() {
  const y = cur.getFullYear(), m = cur.getMonth(), first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const by = {}; for (const t of data.tasks) if (t.due) (by[t.due] ||= []).push(t);
  const mby = {}; for (const m of liveMeetings()) (mby[iso(new Date(m.start))] ||= []).push(m);
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d), tk = by[k] || [], ms = mby[k] || [], ts = [...ms, ...tk];
    if (i >= 35 && d.getMonth() !== m) break;
    cells += `<button class="cell ${d.getMonth() !== m ? "out" : ""} ${k === TODAY ? "today" : ""} ${k === selDay ? "sel" : ""}" data-day="${k}"><span class="n">${d.getDate()}</span><span class="evs">${ts.slice(0, 2).map((t) => t.start ? `<i class="ev mtg" title="Meeting">${hm(t.start)} ${esc(t.title)}</i>` : `<i class="ev ${t.status === "Done" ? "done" : pri(t)}">${esc(t.title)}</i>`).join("")}${ts.length > 2 ? `<i class="more">+${ts.length - 2} more</i>` : ""}</span></button>`;
  }
  $("#cal").innerHTML = `<div class="chead"><h3>${cur.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><div class="nav"><button data-nav="-1" aria-label="Previous month">←</button><button data-nav="0">Today</button><button data-nav="1" aria-label="Next month">→</button></div></div>
  <div class="cgrid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("")}${cells}</div>`;
  const ts = selDay ? data.tasks.filter((t) => t.due === selDay) : [], dm = selDay ? liveMeetings().filter((m) => iso(new Date(m.start)) === selDay) : [];
  $("#day").innerHTML = selDay ? `<h3>${pd(selDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h3>
   ${dm.map((m) => `<div class="drow mtgrow" data-mid="${m.id}"><span class="tm">${hm(m.start)}</span><span class="t">${esc(m.title)} <span class="mstat ms-${m.status.replace(/ /g, "")}">${m.status === "requested" ? "Requested" : "On calendar"}</span></span></div>`).join("")}${ts.map((t) => `<div class="drow ${t.status === "Done" ? "done" : ""}" data-id="${t.id}"><input type="checkbox" class="cb" data-chk="${t.id}" ${t.status === "Done" ? "checked" : ""}><span class="t">${esc(t.title)}</span>${av(t.owner)}</div>`).join("") || dm.length ? "" : `<div class="nothing">Nothing due this day. A nice open one.</div>`}
   <form class="dayadd" id="dayAdd" autocomplete="off"><input placeholder="Add task for this day…" id="dayTitle"><button class="primary sm">Add</button></form>`
   : `<div class="pick">Pick a day to see what is on it, or add something new.</div>`;
}
function renderHours() {
    $("#hours").innerHTML = `<div class="hhead"><h2>This week</h2><small>Target ${TARGET}h each</small></div>` + INTERNS.map((p) => {
    const h = Number(data.hours[p + "|" + WEEK] || 0), pct = Math.min(100, (h / TARGET) * 100);
    return `<div class="hp"><div class="hrow"><b>${p}</b><small>${h} / ${TARGET}h</small><input type="number" min="0" step="0.5" placeholder="0" data-p="${p}" value="${h || ""}"></div><div class="prog"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
}
let demoAsks = [];
const TABS = ["tasks", "calendar", "board", "meetings", "ask", "hours"];
function render() {
  const list = filtered();
  for (const t of TABS) { $("#p" + t[0].toUpperCase() + t.slice(1)).hidden = t !== tab; }
  document.querySelectorAll("#tabs a").forEach((a) => { const on = a.dataset.tab === tab; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  $("#ownerChips").innerHTML = ["", ...OWNERS].map((o) => `<button class="chip ${o === ownerF ? "on" : ""}" data-owner="${o}">${o || "Everyone"}</button>`).join("");
  renderList(list); upNext(); renderBoard(data.tasks); renderCal(); renderMeetings(); renderAsk(); renderHours();
}
function readHash() {
  const p = location.hash.slice(1).toLowerCase().split(/[&?\/,-]+/);
  demo = p.includes("demo"); tab = TABS.find((t) => p.includes(t)) || "tasks";
  if (p.includes("board")) tab = "board";
}
function openModal(t) {
  const f = $("#form"); t = t || { status: "Open", owner: "Unassigned", priority: "Medium", area: "Magpy" };
  $("#mTitle").textContent = t.id ? "Edit task" : "New task"; f.dataset.id = t.id || "";
  for (const k of ["title", "status", "owner", "due", "priority", "area", "notes"]) f.elements[k].value = t[k] || "";
  $("#del").style.display = t.id ? "" : "none"; $("#modal").showModal();
}
const addTask = async (title, due, p) => { title = title.trim(); if (!title) return; await Store.saveTask({ title, status: "Open", owner: ownerF && ownerF !== "" ? ownerF : "Unassigned", due: due || "", priority: p || "Medium", area: "Magpy", notes: "" }); refresh(); };
function applyDemo() {
  const T = data.tasks, off = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  if (T.length < 8) return;
  Object.assign(T[0], { owner: "Can", status: "In Progress", due: off(2) });
  Object.assign(T[1], { owner: "Ariel", status: "In Progress", due: off(0) });
  Object.assign(T[2], { status: "Review", owner: "Myles", due: off(-1), priority: "Urgent" });
  Object.assign(T[3], { owner: "Ariel", due: off(5) });
  Object.assign(T[4], { owner: "Can", due: off(5) });
  Object.assign(T[5], { owner: "Myles", due: off(9) });
  Object.assign(T[6], { owner: "Can", status: "Done", due: off(-3) });
  Object.assign(T[7], { owner: "Ariel", due: off(13) });
  const mt = (n, h, dur, title, at, st, extra = {}) => { const s = new Date(today); s.setDate(s.getDate() + n); s.setHours(h, 0, 0, 0); return { id: "demo" + title, title, start: s.toISOString(), end: new Date(+s + dur * 6e4).toISOString(), attendees: at, notes: "", meet: true, reminderMinutes: 10, status: st, googleEventId: null, ...extra }; };
  data.meetings = [mt(1, 10, 30, "Natrion memo review", ["Myles", "Ariel"], "on calendar", { reminderMinutes: 60 }), mt(3, 14, 60, "Intern sync", ["Myles", "Ariel", "Can"], "requested"), mt(2, 11, 30, "KairosLive facts walkthrough", ["Can"], "on calendar", { notes: "Bring the facts file" })];
  const ago = (m) => new Date(Date.now() - m * 6e4).toISOString();
  data.asks = [
    { id: "da1", text: "Move the Natrion memo to Review", createdBy: "Ariel", createdAt: ago(190), status: "handled", reply: "Done. \"Natrion memo onto the template\" is now in Review.", repliedAt: ago(184) },
    { id: "da2", text: "Schedule a meeting Tuesday at 2 with Myles and Can", createdBy: "Myles", createdAt: ago(75), status: "handled", reply: "Requested \"Intern sync\" for Tuesday at 2:00 PM with Myles and Can. It will show on the calendar shortly.", repliedAt: ago(70) },
    { id: "da3", text: "Which tasks are overdue?", createdBy: "Can", createdAt: ago(3), status: "new", reply: null, repliedAt: null },
    ...demoAsks,
  ];
  data.hours["Ariel|" + WEEK] = 9; data.hours["Can|" + WEEK] = 12.5;
}
function greet() {
  const who = Store.user() || "Ariel";
  const h = new Date().getHours(), g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("#greet").innerHTML = `${g}, ${who}.<span>${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>`;
}
function setupSync() {
  const top = document.querySelector(".top"), box = document.createElement("div");
  box.className = "sync"; box.style.cssText = "display:flex;gap:10px;align-items:center;font-size:12px;color:#6b6b60;margin-top:6px";
  box.innerHTML = `<label>You are <select id="who" style="font:inherit"><option value="">choose…</option>${["Myles", "Ariel", "Can"].map((n) => `<option>${n}</option>`).join("")}</select></label><span id="syncState" aria-live="polite"></span>`;
  top.appendChild(box); $("#who").value = Store.user();
  $("#who").onchange = () => { Store.setUser($("#who").value); greet(); };
  const paint = () => { const s = Store.status(); $("#syncState").textContent = s.demo ? "Demo (local only)" : !s.online ? "● Offline" : s.saving ? "Saving…" : "● Saved"; $("#syncState").style.color = !s.online && !s.demo ? "#b4533c" : ""; };
  paint(); if (demo) return;
  let busy = false, again = false;
  Store.subscribe(async (ev) => {
    paint(); if (ev.type !== "change") return;
    if (busy) { again = true; return; } busy = true;
    try { do { again = false; data = await Store.load(); render(); } while (again); } catch {} busy = false; paint();
  });
}

// ---- meetings
const PEOPLE = ["Myles", "Ariel", "Can"];
const liveMeetings = () => (data.meetings || []).filter((m) => m.status !== "cancelled");
const hm = (s) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
const RLBL = { 10: "10 min before", 60: "1 hour before", 1440: "1 day before" };
const SLBL = { requested: "Requested", "on calendar": "On calendar", cancelled: "Cancelled" };
function mrow(m) {
  const d = new Date(m.start), dur = Math.round((new Date(m.end) - d) / 6e4), gone = m.status === "cancelled";
  const durL = dur >= 60 ? (dur / 60) + " hr" : dur + " min";
  return `<div class="mrow ${gone ? "gone" : ""}" data-mid="${m.id}"><div class="mdate"><b>${d.getDate()}</b><span>${d.toLocaleDateString("en-US", { month: "short" })}</span></div>
  <div style="min-width:0"><div class="mt">${esc(m.title)} <span class="mstat ms-${m.status.replace(/ /g, "")}">${SLBL[m.status]}</span></div>
  <div class="msub">${d.toLocaleDateString("en-US", { weekday: "short" })} · ${hm(m.start)} to ${hm(m.end)} · ${durL}${m.meet ? " · Google Meet" : ""}${RLBL[m.reminderMinutes] ? " · Reminder " + RLBL[m.reminderMinutes] : ""}</div>
  <div class="msub">${m.attendees.length ? esc(m.attendees.join(", ")) : "No attendees"}${m.notes ? " · " + esc(m.notes) : ""}</div></div>
  <div class="mbtns">${gone ? "" : `<button data-medit="${m.id}">Edit</button><button class="danger" data-mcancel="${m.id}">Cancel</button>`}</div></div>`;
}
function renderMeetings() {
  const now = Date.now(), all = (data.meetings || []).slice().sort((a, b) => a.start.localeCompare(b.start));
  const up = all.filter((m) => m.status !== "cancelled" && new Date(m.end) >= now), past = all.filter((m) => m.status !== "cancelled" && new Date(m.end) < now).reverse(), gone = all.filter((m) => m.status === "cancelled");
  const grp = (h, l, open) => l.length || open ? `<div class="mgroup"><h2>${h}<span class="count">${l.length}</span></h2>${l.map(mrow).join("") || `<div class="empty">No upcoming meetings. Schedule one above.</div>`}</div>` : "";
  $("#mlist").innerHTML = grp("Upcoming", up, true) + grp("Past", past) + grp("Cancelled", gone);
}
function mReset() {
  const f = $("#mform"); f.reset(); f.dataset.id = ""; $("#mfTitle").textContent = "Schedule a meeting"; $("#mSave").textContent = "Request meeting"; $("#mReset").hidden = true; $("#mErr").textContent = "";
  f.elements.date.value = TODAY; f.querySelectorAll("#mWho input").forEach((c) => (c.checked = false));
}
function mEdit(m) {
  const f = $("#mform"), s = new Date(m.start), pad = (n) => String(n).padStart(2, "0"); mReset(); f.dataset.id = m.id;
  f.elements.title.value = m.title; f.elements.date.value = iso(s); f.elements.time.value = pad(s.getHours()) + ":" + pad(s.getMinutes());
  const dur = Math.round((new Date(m.end) - s) / 6e4); if (![...f.elements.duration.options].some((o) => +o.value === dur)) f.elements.duration.add(new Option(dur + " min", dur)); f.elements.duration.value = dur;
  const known = m.attendees.filter((a) => PEOPLE.includes(a));
  f.querySelectorAll("#mWho input").forEach((c) => (c.checked = known.includes(c.value)));
  f.elements.extra.value = m.attendees.filter((a) => !PEOPLE.includes(a)).join(", "); f.elements.notes.value = m.notes || "";
  f.elements.meet.checked = !!m.meet; f.elements.reminder.value = String(m.reminderMinutes || 0);
  $("#mfTitle").textContent = "Edit meeting"; $("#mSave").textContent = "Save changes (re-sync)"; $("#mReset").hidden = false; f.scrollIntoView({ behavior: "smooth", block: "start" });
}
function setupMeetings() {
  $("#mWho").innerHTML = PEOPLE.map((n) => `<label><input type="checkbox" value="${n}"> ${n}</label>`).join(""); mReset();
  $("#mReset").onclick = mReset;
  $("#mform").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, el = f.elements, err = $("#mErr"); err.textContent = "";
    const extra = el.extra.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), bad = extra.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (bad) { err.textContent = `"${bad}" is not a valid email.`; return; }
    const start = new Date(el.date.value + "T" + el.time.value); if (isNaN(start)) { err.textContent = "Pick a date and time."; return; }
    const end = new Date(+start + +el.duration.value * 6e4);
    const who = [...f.querySelectorAll("#mWho input:checked")].map((c) => c.value), m = f.dataset.id ? { ...(data.meetings || []).find((x) => x.id === f.dataset.id) } : {};
    Object.assign(m, { title: el.title.value.trim(), start: start.toISOString(), end: end.toISOString(), attendees: [...who, ...extra.filter((x) => !who.includes(x))], notes: el.notes.value.trim(), meet: el.meet.checked, reminderMinutes: +el.reminder.value });
    if (f.dataset.id) delete m.status;
    try { await Store.saveMeeting(m); } catch { err.textContent = "Could not save. Check connection."; return; }
    mReset(); refresh();
  });
  document.addEventListener("click", async (e) => {
    const g = e.target, ed = g.closest("[data-medit]"), cn = g.closest("[data-mcancel]"), dr = g.closest(".mtgrow");
    if (ed) mEdit(data.meetings.find((m) => m.id === ed.dataset.medit));
    else if (cn && confirm("Cancel this meeting?")) { await Store.cancelMeeting(cn.dataset.mcancel); refresh(); }
    else if (dr) { location.hash = "#meetings"; mEdit(data.meetings.find((m) => m.id === dr.dataset.mid)); }
  });
}
async function init() {
  setupMeetings();
  readHash(); setupSync();
  greet();
  $("#fStatus").innerHTML = opts(STATUSES, "All statuses");
  $("#form").elements.status.innerHTML = opts(STATUSES); $("#form").elements.owner.innerHTML = opts(OWNERS);
  $("#fPri").innerHTML = opts(PRIS, "All priorities"); $("#qPri").innerHTML = opts(PRIS); $("#qPri").value = "Medium";
  $("#form").elements.priority.innerHTML = opts(PRIS);
  $("#fStatus").onchange = render; $("#fPri").onchange = render; $("#sortBy").onchange = (e) => { sortBy = e.target.value; render(); };
  const closeMenu = () => { $("#pmenu")?.remove(); document.querySelector("[data-pri][aria-expanded]")?.removeAttribute("aria-expanded"); };
  const openMenu = (btn) => {
    closeMenu(); const t = byId(btn.dataset.pri); if (!t) return; btn.setAttribute("aria-expanded", "true");
    const m = document.createElement("div"); m.id = "pmenu"; m.setAttribute("role", "menu");
    m.innerHTML = PRIS.map((p) => `<button type="button" role="menuitem" class="pm ${p === pri(t) ? "cur" : ""}" data-pset="${p}"><i class="pri ${p}">${p}</i></button>`).join("");
    document.body.appendChild(m); const r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left + scrollX, innerWidth - m.offsetWidth - 8 + scrollX)) + "px"; m.style.top = r.bottom + scrollY + 6 + "px"; m.dataset.id = t.id; if (r.bottom + m.offsetHeight + 12 > innerHeight) m.style.top = r.top + scrollY - m.offsetHeight - 6 + "px"; (m.querySelector(".cur") || m.querySelector(".pm")).focus({ preventScroll: true });
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#pmenu")) { const b = document.querySelector("[data-pri][aria-expanded]"); closeMenu(); b?.focus(); } });
  window.addEventListener("hashchange", () => { readHash(); render(); });
  $("#cancel").onclick = () => $("#modal").close();
  $("#quick").onsubmit = (e) => { e.preventDefault(); const v = $("#qTitle").value; $("#qTitle").value = ""; addTask(v, "", $("#qPri").value); };
  const byId = (id) => data.tasks.find((t) => t.id === id);
  document.addEventListener("click", async (e) => {
    const g = e.target;
    const ps = g.closest("[data-pset]");
    if (ps) { const id = $("#pmenu").dataset.id, t = byId(id); closeMenu(); if (t && t.priority !== ps.dataset.pset) { t.priority = ps.dataset.pset; if (demo) { render(); return; } await Store.saveTask(t); refresh(); } return; }
    const pb = g.closest("[data-pri]"); if (pb) { const was = pb.hasAttribute("aria-expanded"); closeMenu(); if (!was) openMenu(pb); return; }
    closeMenu();
    const chk = g.closest("[data-chk]");
    if (chk) { const t = byId(chk.dataset.chk); t.status = chk.checked ? "Done" : "Open"; if (demo) { render(); return; } await Store.saveTask(t); refresh(); return; }
    const oc = g.closest("[data-owner]"); if (oc) { ownerF = oc.dataset.owner; render(); return; }
    const nav = g.closest("[data-nav]"); if (nav) { const n = +nav.dataset.nav; cur = n === 0 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(cur.getFullYear(), cur.getMonth() + n, 1); if (n === 0) selDay = TODAY; render(); return; }
    const dc = g.closest("[data-day]"); if (dc) { selDay = selDay === dc.dataset.day ? "" : dc.dataset.day; render(); return; }
    const gh = g.closest(".ghead"); if (gh) { const s = gh.parentElement.dataset.g; closed.has(s) ? closed.delete(s) : closed.add(s); render(); return; }
    const el = g.closest("[data-id]"); if (el && el.closest("#upnext,#list,#board,#day")) openModal(byId(el.dataset.id));
  });
  document.addEventListener("submit", (e) => { if (e.target.id === "dayAdd") { e.preventDefault(); const v = $("#dayTitle").value; addTask(v, selDay); } });
  $("#form").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    const f = e.target, t = { id: f.dataset.id || undefined };
    for (const k of ["title", "status", "owner", "due", "priority", "area", "notes"]) t[k] = f.elements[k].value.trim();
    t.area ||= "Magpy"; await Store.saveTask(t); refresh();
  });
  $("#del").onclick = async () => { const id = $("#form").dataset.id; if (id && confirm("Delete this task?")) { await Store.deleteTask(id); $("#modal").close(); refresh(); } };
  $("#hours").addEventListener("change", async (e) => { if (e.target.dataset.p) { await Store.setHours(e.target.dataset.p, WEEK, Math.max(0, +e.target.value || 0)); refresh(); } });
  let dragId = null;
  document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".kcard"); if (c) { dragId = c.dataset.id; c.classList.add("drag"); } });
  document.addEventListener("dragend", () => document.querySelectorAll(".drag,.over").forEach((x) => x.classList.remove("drag", "over")));
  document.addEventListener("dragover", (e) => { const c = e.target.closest?.(".col"); if (c) { e.preventDefault(); c.classList.add("over"); } });
  document.addEventListener("dragleave", (e) => e.target.closest?.(".col")?.classList.remove("over"));
  document.addEventListener("drop", async (e) => {
    const c = e.target.closest?.(".col"); if (!c || !dragId) return; e.preventDefault();
    const t = byId(dragId); dragId = null; if (t && t.status !== c.dataset.status) { t.status = c.dataset.status; if (!demo) await Store.saveTask(t); } refresh();
  });
  readHash();
  if (demo && tab === "calendar") selDay = TODAY;
  await refresh();
  if (/modal/.test(location.hash)) openModal(data.tasks[1]);
  if (/pmenu/.test(location.hash)) document.querySelectorAll("#upnext [data-pri]")[1]?.click();
}
init();

// ---- Ask tab ----
const PROMPTS = ["Move the Natrion memo to Review", "Schedule a meeting Tuesday at 2", "What's due this week?", "Add a task: Robotaxi primer outline"];
const esc2 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const askTime = (iso) => { const d = new Date(iso), t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + t; };
let askSig = "";
function renderAsk() {
  const el = $("#askThread"), asks = data.asks || [], sig = JSON.stringify(asks) + tab;
  if (sig === askSig) return; askSig = sig;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60, first = !el.dataset.done;
  el.innerHTML = asks.length ? asks.map((a) => `<div class="ask"><div class="bub me"><div class="bwho"><i class="av av-${esc2(a.createdBy)}">${esc2((a.createdBy || "?")[0])}</i><b>${esc2(a.createdBy || "Someone")}</b><small>${askTime(a.createdAt)}</small></div><p>${esc2(a.text)}</p></div>${
    a.status === "handled" ? `<div class="bub bot"><div class="bwho"><b>Assistant</b><small>${a.repliedAt ? askTime(a.repliedAt) : ""}</small></div><p>${esc2(a.reply || "Done.")}</p></div>` : `<div class="wait"><span class="dot"></span>Waiting for the assistant</div>`}</div>`).join("")
    : `<p class="empty">Nothing here yet. Ask for something below, like moving a task or scheduling a meeting.</p>`;
  if (first || near) { el.scrollTop = el.scrollHeight; el.dataset.done = "1"; }
}
async function sendAsk() {
  const ta = $("#askText"), text = ta.value.trim(); if (!text) return;
  ta.value = ""; ta.style.height = "";
  if (demo) { demoAsks.push({ id: "dl" + Date.now(), text, createdBy: Store.user() || "Ariel", createdAt: new Date().toISOString(), status: "new", reply: null, repliedAt: null }); await refresh(); $("#askThread").scrollTop = 1e9; return; }
  try { await Store.sendAsk(text); } catch { ta.value = text; return; }
  data = await Store.load(); render(); $("#askThread").scrollTop = 1e9;
}
(function () {
  const go = () => {
    $("#askChips").innerHTML = PROMPTS.map((p) => `<button type="button" class="pchip">${esc2(p)}</button>`).join("");
    $("#askChips").onclick = (e) => { const b = e.target.closest(".pchip"); if (b) { $("#askText").value = b.textContent; $("#askText").focus(); } };
    $("#askForm").onsubmit = (e) => { e.preventDefault(); sendAsk(); };
    $("#askText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAsk(); } });
    $("#askText").addEventListener("input", (e) => { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; });
  };
  go();
})();
