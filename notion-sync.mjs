// Pull Magpy intern tasks from the Notion "Solavant Interns · Tasks" database.
// The dashboard used to keep its own JSON / Durable Object copy and never asked Notion again.
// A second database, "Magpy Intern Dashboard (Ariel)", is only an old export of that copy.
// The SCM Team integration can read Solavant Interns · Tasks. The older Intern Tasks id 404s for that token.

export const INTERN_TASKS_DATABASE_ID = "057cf17c94bb4acf988f926775660ab8";
// Stale export of the dashboard's own rows (Name / Dashboard ID / Source). Not the board Myles edits.
export const STALE_MIRROR_DATABASE_ID = "67b0ae62643246289339316b82f2a13e";
export const NOTION_VERSION = "2022-06-28";
export const DEFAULT_SYNC_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export const SEED_TITLES = [
  "Natrion source list",
  "Natrion memo onto the template",
  "Natrion sonar",
  "Natrion growth drivers",
  "KairosLive facts file",
  "Robotaxi primer",
  "SAFE math explainer",
  "Deal Evidence File blank template",
];

const DASH_STATUS = {
  open: "Open",
  "not started": "Open",
  "in progress": "In Progress",
  inprogress: "In Progress",
  review: "Review",
  done: "Done",
};

export function normalizeDatabaseId(id) {
  return String(id || "").replace(/-/g, "").trim().toLowerCase();
}

export function resolveDatabaseId(raw) {
  const id = normalizeDatabaseId(raw);
  if (!id) return { databaseId: INTERN_TASKS_DATABASE_ID, warning: "" };
  if (id === STALE_MIRROR_DATABASE_ID) {
    return {
      databaseId: INTERN_TASKS_DATABASE_ID,
      warning: "NOTION_DATABASE_ID points at the stale Magpy Intern Dashboard mirror, not Solavant Interns · Tasks. Reading Solavant Interns · Tasks instead.",
    };
  }
  return { databaseId: id, warning: "" };
}

export function blankNotionMeta() {
  return { syncedAt: 0, error: "", warning: "", databaseId: "", schema: null, count: 0 };
}

function textOf(prop) {
  if (!prop || typeof prop !== "object") return "";
  if (prop.type === "title") return (prop.title || []).map((t) => t.plain_text || "").join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((t) => t.plain_text || "").join("");
  if (prop.type === "select") return (prop.select && prop.select.name) || "";
  if (prop.type === "status") return (prop.status && prop.status.name) || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "date") return (prop.date && prop.date.start) || "";
  return "";
}

function dateOnly(s) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || ""));
  return m ? m[1] : "";
}

function dashStatus(s) {
  const k = String(s || "").trim().toLowerCase();
  return DASH_STATUS[k] || (k ? "Open" : "Open");
}

function dashPriority(s) {
  const k = String(s || "").trim().toLowerCase();
  if (k === "urgent") return "Urgent";
  if (k === "high") return "High";
  if (k === "medium") return "Medium";
  if (k === "low") return "Low";
  return "Medium";
}

// Solavant Interns · Tasks: title is "Task name", Status is a status property
// (Not started / In progress / Review / Done), Owner is a select (there is no Assignee),
// Area includes Solavant, and there is no Description, Brief, or Output link column.
export const DEFAULT_SCHEMA = {
  title: "Task name",
  status: "Status",
  statusType: "status",
  owner: "Owner",
  priority: "Priority",
  area: "Area",
  due: "Due",
  notes: "",
  brief: "",
  output: "",
  statusValues: ["Not started", "In progress", "Review", "Done"],
  ownerValues: ["Ariel", "Can", "Myles", "Advay"],
  priorityValues: ["High", "Medium", "Low"],
  areaValues: ["Magpy", "Optix", "Krino", "Solavant", "Research", "Other"],
};

function remember(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

// Learn real property names and types from a page. Notion includes every column, so a missing
// Description / Brief / Output link means that column does not exist and must not be written.
export function learnSchema(page, schema) {
  const props = (page && page.properties) || {};
  const titleKey = Object.keys(props).find((k) => props[k] && props[k].type === "title");
  if (titleKey) schema.title = titleKey;
  const statusProp = props.Status;
  if (statusProp && (statusProp.type === "status" || statusProp.type === "select")) {
    schema.status = "Status";
    schema.statusType = statusProp.type;
  }
  const use = (name, type, field) => { if (props[name] && props[name].type === type) schema[field] = name; };
  use("Owner", "select", "owner");
  use("Priority", "select", "priority");
  use("Area", "select", "area");
  use("Due", "date", "due");
  if (props.Description && props.Description.type === "rich_text") schema.notes = "Description";
  else if (props.Notes && props.Notes.type === "rich_text") schema.notes = "Notes";
  else schema.notes = "";
  if (props.Brief && props.Brief.type === "url") schema.brief = "Brief";
  else schema.brief = "";
  if (props["Output link"] && props["Output link"].type === "url") schema.output = "Output link";
  else schema.output = "";
  remember(schema.statusValues, textOf(props[schema.status]));
  remember(schema.ownerValues, textOf(props[schema.owner]));
  remember(schema.priorityValues, textOf(props[schema.priority]));
  remember(schema.areaValues, textOf(props[schema.area]));
  return schema;
}

function cloneSchema(schema) {
  const s = schema || DEFAULT_SCHEMA;
  return {
    ...DEFAULT_SCHEMA,
    ...s,
    statusType: s.statusType || DEFAULT_SCHEMA.statusType,
    statusValues: [...(s.statusValues || DEFAULT_SCHEMA.statusValues)],
    ownerValues: [...(s.ownerValues || DEFAULT_SCHEMA.ownerValues)],
    priorityValues: [...(s.priorityValues || DEFAULT_SCHEMA.priorityValues)],
    areaValues: [...(s.areaValues || DEFAULT_SCHEMA.areaValues)],
  };
}

function linkDoc(id, url, title, at) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { id, url: String(url).slice(0, 2000), title: title.slice(0, 120), addedBy: "Notion", addedAt: at || new Date().toISOString() };
}

export function mapPage(page, schema) {
  const s = learnSchema(page, cloneSchema(schema));
  const props = page.properties || {};
  const notionId = String(page.id || "").replace(/-/g, "");
  const at = page.last_edited_time || "";
  const notes = textOf(props[s.notes]).slice(0, 4000);
  const docs = [linkDoc("notion-brief", textOf(props[s.brief]), "Brief", at), linkDoc("notion-output", textOf(props[s.output]), "Output", at)].filter(Boolean);
  const owner = textOf(props[s.owner]).trim();
  return {
    schema: s,
    task: {
      id: notionId,
      notionId,
      notionEdited: at,
      notionUrl: page.url || "",
      title: textOf(props[s.title]).trim().slice(0, 500) || "(untitled)",
      status: dashStatus(textOf(props[s.status])),
      owner: owner || "Unassigned",
      due: dateOnly(textOf(props[s.due])),
      priority: dashPriority(textOf(props[s.priority])),
      area: textOf(props[s.area]).trim() || "Magpy",
      notes,
      docs,
      updatedAt: Date.parse(at) || Date.now(),
      localDirty: false,
    },
  };
}

function explainHttp(status, message) {
  const detail = String(message || "").slice(0, 240);
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401) return `Notion rejected the token (401${suffix}). Check NOTION_TOKEN.`;
  if (status === 403 || status === 404) return `Notion could not read Solavant Interns · Tasks (${status}${suffix}). Share that database with the integration. The old Intern Tasks database and the Magpy Intern Dashboard mirror are different databases.`;
  return `Notion error (${status}): ${detail}`;
}

// The board hides rows whose Archived checkbox is set. Those rows are not deleted in Notion.
export function pageHiddenFromBoard(page) {
  const prop = page && page.properties && page.properties.Archived;
  return !!(prop && prop.type === "checkbox" && prop.checkbox);
}

// Follow has_more / next_cursor. A single page is at most 100 rows; stopping there hides later edits.
export async function queryAllPages({ token, databaseId, apiBase, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const base = String(apiBase || "https://api.notion.com/v1").replace(/\/$/, "");
  const pages = [];
  let cursor = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const body = { page_size: PAGE_SIZE };
    if (cursor) body.start_cursor = cursor;
    let r, text;
    try {
      r = await fetchFn(`${base}/databases/${databaseId}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      text = await r.text();
    } catch (e) {
      return { pages, error: `Could not reach Notion: ${e.message || e}`, incomplete: true };
    }
    let j = null;
    try { j = JSON.parse(text); } catch { j = null; }
    if (!r.ok) return { pages, error: explainHttp(r.status, j && j.message), incomplete: true };
    pages.push(...(Array.isArray(j.results) ? j.results : []));
    if (!j.has_more) return { pages, error: "", incomplete: false };
    if (!j.next_cursor) return { pages, error: "Notion returned has_more without next_cursor, so the rest of the board was not read.", incomplete: true };
    cursor = j.next_cursor;
  }
  return { pages, error: "Stopped after 50 pages so a cursor loop cannot run forever.", incomplete: true };
}

export function isUntouchedSeed(t, comments) {
  if (!t || t.notionId || t.localDirty) return false;
  if (!SEED_TITLES.includes(t.title)) return false;
  if (t.status !== "Open" || (t.owner && t.owner !== "Unassigned") || t.due || t.notes) return false;
  if (Array.isArray(t.docs) && t.docs.length) return false;
  if (comments && Array.isArray(comments[t.id]) && comments[t.id].length) return false;
  return true;
}

function docKey(docs) {
  return (docs || []).map((d) => `${d.id}|${d.url}|${d.title}`).join("\n");
}

function sameFields(a, b) {
  for (const k of ["title", "status", "owner", "due", "priority", "area", "notes"]) if ((a[k] || "") !== (b[k] || "")) return false;
  return docKey(a.docs) === docKey(b.docs);
}

function mergeDocs(local, incoming) {
  const ids = new Set((incoming || []).map((d) => d.id));
  const keep = (Array.isArray(local) ? local : []).filter((d) => d && !ids.has(d.id));
  return [...(incoming || []), ...keep].slice(0, 20);
}

// Notion is the board. A complete pull drops every local row that was never written to Notion
// (starter tasks, one-off notes such as "hi") unless a dashboard save is still waiting to push.
export function tasksForView(tasks, configured) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!configured) return list;
  return list.filter((t) => t && (t.notionId || t.localDirty));
}

export function mergeNotionTasks(tasks, pages, tombstones, { partial, dropSeeds, comments } = {}) {
  const tombs = { ...(tombstones || {}) };
  const schema = cloneSchema();
  let changed = false;
  const dropped = [];
  const kept = [];
  for (const t of tasks || []) {
    if (dropSeeds && t && !t.notionId && !t.localDirty) {
      changed = true;
      dropped.push(String(t.title || "Untitled"));
      continue;
    }
    kept.push(t);
  }
  const index = new Map();
  for (const t of kept) index.set(t.notionId || t.id, t);
  const seen = new Set();
  for (const page of pages || []) {
    if (!page || page.archived || !page.id || pageHiddenFromBoard(page)) continue;
    const mapped = mapPage(page, schema);
    Object.assign(schema, mapped.schema);
    schema.statusValues = mapped.schema.statusValues;
    schema.ownerValues = mapped.schema.ownerValues;
    schema.priorityValues = mapped.schema.priorityValues;
    schema.areaValues = mapped.schema.areaValues;
    const nt = mapped.task;
    seen.add(nt.notionId);
    if (tombs[nt.id] && tombs[nt.id] > nt.updatedAt) continue;
    const cur = index.get(nt.notionId);
    if (!cur) {
      kept.push(nt); index.set(nt.notionId, nt); changed = true; continue;
    }
    const notionMs = Date.parse(page.last_edited_time);
    // A dashboard edit that has not reached Notion yet wins only when it is newer than Notion's last_edited_time.
    if (cur.localDirty && +cur.localEditedAt > notionMs) continue;
    const docs = mergeDocs(cur.docs, nt.docs);
    const next = { ...cur, ...nt, id: cur.id, docs, localDirty: false };
    if (sameFields(cur, next)) {
      if (cur.notionEdited !== nt.notionEdited) cur.notionEdited = nt.notionEdited;
      continue;
    }
    Object.assign(cur, next, { updatedAt: Date.now() });
    changed = true;
  }
  if (!partial) {
    for (let i = kept.length - 1; i >= 0; i--) {
      const t = kept[i];
      if (t.notionId && !seen.has(t.notionId)) {
        tombs[t.id] = Date.now();
        kept.splice(i, 1);
        changed = true;
      }
    }
  }
  return { tasks: kept, tombstones: tombs, changed, schema, dropped };
}

function pickValue(values, want, fallback) {
  const hit = (values || []).find((v) => v.toLowerCase() === String(want || "").trim().toLowerCase());
  if (hit) return hit;
  return fallback;
}

// Dashboard "Open" is the Solavant status option "Not started". A select board that still has "Open" keeps that name.
function notionStatusName(schema, taskStatus) {
  const want = String(taskStatus || "").trim();
  const low = want.toLowerCase();
  const find = (name) => (schema.statusValues || []).find((v) => v.toLowerCase() === name);
  if (low === "open" || low === "") {
    const open = find("open");
    if (open) return open;
    const notStarted = find("not started");
    if (notStarted) return notStarted;
    return "Open";
  }
  if (low === "in progress") {
    const hit = find("in progress");
    if (hit) return hit;
  }
  return find(low) || want;
}

export function propertiesForTask(task, schema) {
  const s = cloneSchema(schema);
  const title = String(task.title || "").slice(0, 2000);
  const status = notionStatusName(s, task.status);
  const priority = pickValue(s.priorityValues, task.priority, task.priority === "Urgent" ? "High" : (task.priority || "Medium"));
  const area = pickValue(s.areaValues, task.area || "Magpy", (s.areaValues || []).includes("Magpy") ? "Magpy" : (task.area || "Magpy"));
  const ownerKnown = pickValue(s.ownerValues, task.owner, "");
  const statusValue = status ? { name: status } : null;
  const props = {};
  if (s.title) props[s.title] = { title: [{ type: "text", text: { content: title } }] };
  if (s.status) props[s.status] = s.statusType === "select" ? { select: statusValue } : { status: statusValue };
  if (s.priority) props[s.priority] = { select: priority ? { name: priority } : null };
  if (s.area) props[s.area] = { select: area ? { name: area } : null };
  if (s.due) props[s.due] = { date: /^\d{4}-\d{2}-\d{2}$/.test(task.due || "") ? { start: task.due } : null };
  if (s.notes) props[s.notes] = { rich_text: task.notes ? [{ type: "text", text: { content: String(task.notes).slice(0, 2000) } }] : [] };
  if (s.owner) {
    const name = ownerKnown && task.owner && task.owner !== "Unassigned" ? ownerKnown : "";
    props[s.owner] = { select: name ? { name } : null };
  }
  return props;
}

async function notionWrite({ token, apiBase, fetchImpl, method, path, body }) {
  const fetchFn = fetchImpl || fetch;
  const base = String(apiBase || "https://api.notion.com/v1").replace(/\/$/, "");
  const r = await fetchFn(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { j = null; }
  if (!r.ok) throw new Error(explainHttp(r.status, j && j.message));
  return j || {};
}

export function notionPublic(meta, configured, tasks) {
  const n = meta || {};
  return {
    configured: !!configured,
    ok: !!configured && !n.error,
    databaseId: configured ? (n.databaseId || "") : "",
    syncedAt: n.syncedAt || 0,
    error: configured ? (n.error || "") : "",
    warning: configured ? (n.warning || "") : "",
    count: (tasks || []).filter((t) => t.notionId).length,
    droppedLocal: configured ? (n.droppedLocal || []) : [],
  };
}

export function createNotionSync(opts) {
  let inflight = null, inflightForce = false;
  const syncMs = () => {
    const n = +opts.syncMs();
    return Number.isFinite(n) && n >= 5000 ? n : DEFAULT_SYNC_MS;
  };
  const state = () => opts.getState();
  const metaOf = () => state().notion || (state().notion = blankNotionMeta());
  function snap() {
    const configured = !!opts.token();
    return notionPublic(state().notion, configured, state().tasks);
  }
  async function run() {
    const token = opts.token();
    const { databaseId, warning } = resolveDatabaseId(opts.databaseId());
    const meta = metaOf();
    meta.databaseId = databaseId;
    meta.warning = warning;
    const result = await queryAllPages({ token, databaseId, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl });
    meta.syncedAt = Date.now();
    const st = state();
    if (result.incomplete && result.pages.length === 0) {
      meta.error = result.error || "Notion sync failed";
      await opts.commit({ tasks: st.tasks, tombstones: st.tombstones, notion: meta }, { tasksChanged: false });
      return;
    }
    const merged = mergeNotionTasks(st.tasks, result.pages, st.tombstones, {
      partial: !!result.incomplete,
      dropSeeds: !result.incomplete && result.pages.length > 0,
      comments: st.comments,
    });
    meta.error = result.error || "";
    meta.schema = merged.schema;
    meta.count = merged.tasks.filter((t) => t.notionId).length;
    if (merged.dropped.length) meta.droppedLocal = merged.dropped;
    await opts.commit({ tasks: merged.tasks, tombstones: merged.tombstones, notion: meta }, { tasksChanged: merged.changed, dropped: merged.dropped });
  }
  function start(force) {
    if (inflight && (inflightForce || !force)) return inflight;
    if (inflight && force && !inflightForce) return inflight.then(() => refresh(true));
    inflightForce = !!force;
    inflight = run().finally(() => { inflight = null; inflightForce = false; });
    return inflight;
  }
  async function refresh(force) {
    if (!opts.token()) return snap();
    const meta = state().notion || {};
    const wait = meta.error ? Math.min(syncMs(), 10_000) : syncMs();
    const fresh = meta.syncedAt && Date.now() - meta.syncedAt < wait;
    const hasLocalOnly = (state().tasks || []).some((t) => t && !t.notionId && !t.localDirty);
    if (!force && fresh && !hasLocalOnly) return snap();
    const job = start(!!force);
    const have = (state().tasks || []).some((t) => t.notionId);
    if (!force && have && !hasLocalOnly) return snap();
    await job;
    return snap();
  }
  async function pushTask(task) {
    const token = opts.token();
    if (!token || !task) return { task, error: "" };
    task.localDirty = true;
    task.localEditedAt = +task.updatedAt || Date.now();
    const meta = metaOf();
    const schema = meta.schema || DEFAULT_SCHEMA;
    const { databaseId } = resolveDatabaseId(opts.databaseId() || meta.databaseId);
    try {
      const j = task.notionId
        ? await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "PATCH", path: `/pages/${task.notionId}`, body: { properties: propertiesForTask(task, schema) } })
        : await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "POST", path: "/pages", body: { parent: { database_id: databaseId }, properties: propertiesForTask(task, schema) } });
      if (j.id) task.notionId = String(j.id).replace(/-/g, "");
      if (j.last_edited_time) task.notionEdited = j.last_edited_time;
      if (j.url) task.notionUrl = j.url;
      task.localDirty = false;
      return { task, error: "" };
    } catch (e) {
      return { task, error: e.message || String(e) };
    }
  }
  async function archiveTask(task) {
    const token = opts.token();
    if (!token || !task || !task.notionId) return { error: "" };
    try {
      await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "PATCH", path: `/pages/${task.notionId}`, body: { archived: true } });
      return { error: "" };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }
  return { refresh, pushTask, archiveTask, snap };
}
