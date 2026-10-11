const STATUSES = ["Open", "In Progress", "Review", "Done"];
const OWNERS = ["Myles", "Ariel", "Can", "Unassigned"];
const INTERNS = ["Ariel", "Can"], TARGET = 15;
const SCOLOR = { Open: "var(--s-open)", "In Progress": "var(--s-prog)", Review: "var(--s-rev)", Done: "var(--s-done)" };
const I = (p, c = "ic") => `<svg class="${c}" viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
const ICONS = { caret: '<path d="M4.5 6.5 8 10l3.5-3.5"/>', prev: '<path d="M9.5 4 5.5 8l4 4"/>', next: '<path d="M6.5 4l4 4-4 4"/>', cal: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>', clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>', inbox: '<path d="M2.5 9.5 4 4a1.5 1.5 0 0 1 1.4-1h5.2A1.5 1.5 0 0 1 12 4l1.5 5.5v2a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M2.5 9.5h3l.8 1.5h3.4l.8-1.5h3"/>', list: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>', board: '<rect x="2.5" y="3" width="4" height="10" rx="1.2"/><rect x="9.5" y="3" width="4" height="6" rx="1.2"/>' };
const $ = (s) => document.querySelector(s);
let data = { tasks: [], hours: {} }, tab = "tasks", ownerF = "", selDay = "", demo = false;
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
const pri = (t) => t.priority || "Low";

async function refresh() { data = await Store.load(); if (demo) applyDemo(); render(); }
function filtered() {
  const s = $("#fStatus").value;
  return data.tasks.filter((t) => (!ownerF || t.owner === ownerF) && (!s || t.status === s));
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
  <div class="meta">${dueChip(t)}<span class="status st-${t.status.replace(/ /g,"")}">${t.status}</span><span class="pri ${pri(t)}">${pri(t)}</span>${av(t.owner)}</div></div>`;
}
function renderList(list) {
  $("#list").innerHTML = STATUSES.map((s) => {
    const ts = list.filter((t) => t.status === s);
    return `<div class="group ${closed.has(s) ? "closed" : ""}" data-g="${s}"><div class="ghead"><h2>${s}</h2><span class="count">${ts.length}</span></div>
    <div class="rows">${ts.map(row).join("") || `<div class="empty">Nothing here yet</div>`}</div></div>`;
  }).join("");
}
function upNext() {
  const R = { High: 0, Medium: 1, Low: 2 };
  const ts = data.tasks.filter((t) => t.status !== "Done" && (!ownerF || t.owner === ownerF))
    .sort((x, y) => (x.due ? 0 : 1) - (y.due ? 0 : 1) || (x.due || "").localeCompare(y.due || "") || R[pri(x)] - R[pri(y)]).slice(0, 5);
  $("#upnext").innerHTML = `<div class="uhead"><h2>Up next</h2><span class="ornament">A few things to look at first</span></div>` + (ts.map((t) =>
    `<div class="row" data-id="${t.id}"><input type="checkbox" class="cb" data-chk="${t.id}" aria-label="Mark done">
    <div class="title">${esc(t.title)}</div><div class="meta">${dueChip(t) || '<span class="due">No date</span>'}<span class="pri ${pri(t)}">${pri(t)}</span>${av(t.owner)}</div></div>`).join("")
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
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d), ts = by[k] || [];
    if (i >= 35 && d.getMonth() !== m) break;
    cells += `<button class="cell ${d.getMonth() !== m ? "out" : ""} ${k === TODAY ? "today" : ""} ${k === selDay ? "sel" : ""}" data-day="${k}"><span class="n">${d.getDate()}</span><span class="evs">${ts.slice(0, 2).map((t) => `<i class="ev ${t.status === "Done" ? "done" : pri(t)}">${esc(t.title)}</i>`).join("")}${ts.length > 2 ? `<i class="more">+${ts.length - 2} more</i>` : ""}</span></button>`;
  }
  $("#cal").innerHTML = `<div class="chead"><h3>${cur.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><div class="nav"><button data-nav="-1" aria-label="Previous month">←</button><button data-nav="0">Today</button><button data-nav="1" aria-label="Next month">→</button></div></div>
  <div class="cgrid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("")}${cells}</div>`;
  const ts = selDay ? data.tasks.filter((t) => t.due === selDay) : [];
  $("#day").innerHTML = selDay ? `<h3>${pd(selDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h3>
   ${ts.map((t) => `<div class="drow ${t.status === "Done" ? "done" : ""}" data-id="${t.id}"><input type="checkbox" class="cb" data-chk="${t.id}" ${t.status === "Done" ? "checked" : ""}><span class="t">${esc(t.title)}</span>${av(t.owner)}</div>`).join("") || `<div class="nothing">Nothing due this day. A nice open one.</div>`}
   <form class="dayadd" id="dayAdd" autocomplete="off"><input placeholder="Add task for this day…" id="dayTitle"><button class="primary sm">Add</button></form>`
   : `<div class="pick">Pick a day to see what is on it, or add something new.</div>`;
}
function renderHours() {
    $("#hours").innerHTML = `<div class="hhead"><h2>This week</h2><small>Target ${TARGET}h each</small></div>` + INTERNS.map((p) => {
    const h = Number(data.hours[p + "|" + WEEK] || 0), pct = Math.min(100, (h / TARGET) * 100);
    return `<div class="hp"><div class="hrow"><b>${p}</b><small>${h} / ${TARGET}h</small><input type="number" min="0" step="0.5" placeholder="0" data-p="${p}" value="${h || ""}"></div><div class="prog"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
}
const TABS = ["tasks", "calendar", "board", "hours"];
function render() {
  const list = filtered();
  for (const t of TABS) { $("#p" + t[0].toUpperCase() + t.slice(1)).hidden = t !== tab; }
  document.querySelectorAll("#tabs a").forEach((a) => { const on = a.dataset.tab === tab; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  $("#ownerChips").innerHTML = ["", ...OWNERS].map((o) => `<button class="chip ${o === ownerF ? "on" : ""}" data-owner="${o}">${o || "Everyone"}</button>`).join("");
  renderList(list); upNext(); renderBoard(data.tasks); renderCal(); renderHours();
}
function readHash() {
  const p = location.hash.slice(1).toLowerCase().split(/[&?\/,-]+/);
  demo = p.includes("demo"); tab = TABS.find((t) => p.includes(t)) || "tasks";
  if (p.includes("board")) tab = "board";
}
function openModal(t) {
  const f = $("#form"); t = t || { status: "Open", owner: "Unassigned", priority: "Low", area: "Magpy" };
  $("#mTitle").textContent = t.id ? "Edit task" : "New task"; f.dataset.id = t.id || "";
  for (const k of ["title", "status", "owner", "due", "priority", "area", "notes"]) f.elements[k].value = t[k] || "";
  $("#del").style.display = t.id ? "" : "none"; $("#modal").showModal();
}
const addTask = async (title, due) => { title = title.trim(); if (!title) return; await Store.saveTask({ title, status: "Open", owner: ownerF && ownerF !== "" ? ownerF : "Unassigned", due: due || "", priority: "Low", area: "Magpy", notes: "" }); refresh(); };
function applyDemo() {
  const T = data.tasks, off = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  if (T.length < 8) return;
  Object.assign(T[0], { owner: "Can", status: "In Progress", due: off(2) });
  Object.assign(T[1], { owner: "Ariel", status: "In Progress", due: off(0) });
  Object.assign(T[2], { status: "Review", owner: "Myles", due: off(-1) });
  Object.assign(T[3], { owner: "Ariel", due: off(5) });
  Object.assign(T[4], { owner: "Can", due: off(5) });
  Object.assign(T[5], { owner: "Myles", due: off(9) });
  Object.assign(T[6], { owner: "Can", status: "Done", due: off(-3) });
  Object.assign(T[7], { owner: "Ariel", due: off(13) });
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
async function init() {
  readHash(); setupSync();
  greet();
  $("#fStatus").innerHTML = opts(STATUSES, "All statuses");
  $("#form").elements.status.innerHTML = opts(STATUSES); $("#form").elements.owner.innerHTML = opts(OWNERS);
  $("#fStatus").onchange = render;
  window.addEventListener("hashchange", () => { readHash(); render(); });
  $("#cancel").onclick = () => $("#modal").close();
  $("#quick").onsubmit = (e) => { e.preventDefault(); const v = $("#qTitle").value; $("#qTitle").value = ""; addTask(v, ""); };
  const byId = (id) => data.tasks.find((t) => t.id === id);
  document.addEventListener("click", async (e) => {
    const g = e.target;
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
}
init();
