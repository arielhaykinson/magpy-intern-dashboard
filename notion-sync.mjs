// Pull Magpy intern tasks from the Notion "Solavant Interns · Tasks" database.
// The dashboard used to keep its own JSON / Durable Object copy and never asked Notion again.
// A second database, "Magpy Intern Dashboard (Ariel)", is only an old export of that copy.
// The SCM Team integration can read Solavant Interns · Tasks. The older Intern Tasks id 404s for that token.

export const INTERN_TASKS_DATABASE_ID = "057cf17c94bb4acf988f926775660ab8";
// Solavant Private Capital. Separate from the intern board. Never fall back to INTERN_TASKS_DATABASE_ID.
export const PRIVATES_TASKS_DATABASE_ID = "c7832a86522a4e26ae7311d9662c460b";
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
  defaultArea: "Magpy",
  section: "Section",
  sectionValues: ["Magpy", "Private"],
  defaultSection: "Magpy",
};

// Solavant Private · Tasks uses the same status and owner columns, and a shorter Area list.
export const PRIVATES_SCHEMA = {
  ...DEFAULT_SCHEMA,
  defaultArea: "Solavant Private",
  areaValues: ["Solavant Private", "Research", "Other"],
  defaultSection: "Private",
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
  if (props.Section && (props.Section.type === "select" || props.Section.type === "status")) schema.section = "Section";
  remember(schema.statusValues, textOf(props[schema.status]));
  remember(schema.ownerValues, textOf(props[schema.owner]));
  remember(schema.priorityValues, textOf(props[schema.priority]));
  remember(schema.areaValues, textOf(props[schema.area]));
  remember(schema.sectionValues, textOf(props.Section));
  return schema;
}

function cloneSchema(schema) {
  const s = schema || DEFAULT_SCHEMA;
  return {
    ...DEFAULT_SCHEMA,
    ...s,
    statusType: s.statusType || DEFAULT_SCHEMA.statusType,
    defaultArea: s.defaultArea || DEFAULT_SCHEMA.defaultArea || "Magpy",
    defaultSection: s.defaultSection || DEFAULT_SCHEMA.defaultSection || "Magpy",
    section: s.section === undefined ? DEFAULT_SCHEMA.section : s.section,
    statusValues: [...(s.statusValues || DEFAULT_SCHEMA.statusValues)],
    ownerValues: [...(s.ownerValues || DEFAULT_SCHEMA.ownerValues)],
    priorityValues: [...(s.priorityValues || DEFAULT_SCHEMA.priorityValues)],
    areaValues: [...(s.areaValues || DEFAULT_SCHEMA.areaValues)],
    sectionValues: [...(s.sectionValues || DEFAULT_SCHEMA.sectionValues)],
  };
}

// "Private" and "Magpy" are explicit. Anything else, including an empty Section, stays with the database the page came from.
export function routeSection(sectionValue, source) {
  const s = String(sectionValue || "").trim().toLowerCase();
  if (s === "private" || s === "privates") return "privates";
  if (s === "magpy") return "magpy";
  return source === "privates" ? "privates" : "magpy";
}

export function sectionValueOf(page) {
  const props = (page && page.properties) || {};
  return textOf(props.Section).trim();
}

export function canonicalSection(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "private" || s === "privates") return "Private";
  if (s === "magpy") return "Magpy";
  return "";
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
      area: textOf(props[s.area]).trim() || s.defaultArea || "Magpy",
      section: canonicalSection(sectionValueOf(page)),
      source: page._source === "privates" ? "privates" : page._source === "magpy" ? "magpy" : "",
      notes,
      docs,
      updatedAt: Date.parse(at) || Date.now(),
      localDirty: false,
    },
  };
}

function explainHttp(status, message, label) {
  const detail = String(message || "").slice(0, 240);
  const suffix = detail ? `: ${detail}` : "";
  const name = label || "Solavant Interns · Tasks";
  if (status === 401) return `Notion rejected the token (401${suffix}). Check NOTION_TOKEN.`;
  if (status === 403 || status === 404) {
    if (name === "Solavant Interns · Tasks") return `Notion could not read Solavant Interns · Tasks (${status}${suffix}). Share that database with the integration. The old Intern Tasks database and the Magpy Intern Dashboard mirror are different databases.`;
    return `Not connected. Notion could not read ${name} (${status}${suffix}). In Notion, open Solavant Private and add the SCM Team connection to that database. Tasks tagged Private on Solavant Interns · Tasks still show here. This database fills in on its own once access is granted.`;
  }
  return `Notion error (${status}): ${detail}`;
}

// The board hides rows whose Archived checkbox is set. Those rows are not deleted in Notion.
export function pageHiddenFromBoard(page) {
  const prop = page && page.properties && page.properties.Archived;
  return !!(prop && prop.type === "checkbox" && prop.checkbox);
}

// Follow has_more / next_cursor. A single page is at most 100 rows; stopping there hides later edits.
export async function queryAllPages({ token, databaseId, apiBase, fetchImpl, label }) {
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
    if (!r.ok) return { pages, error: explainHttp(r.status, j && j.message, label), incomplete: true };
    pages.push(...(Array.isArray(j.results) ? j.results : []));
    if (!j.has_more) return { pages, error: "", incomplete: false };
    if (!j.next_cursor) return { pages, error: "Notion returned has_more without next_cursor, so the rest of the board was not read.", incomplete: true };
    cursor = j.next_cursor;
  }
  return { pages, error: "Stopped after 50 pages so a cursor loop cannot run forever.", incomplete: true };
}

// Select and status options live on the database, not on an empty query. A failed retrieve
// leaves the schema learned from pages so a Magpy pull still succeeds.
export async function retrieveDatabase({ token, databaseId, apiBase, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const base = String(apiBase || "https://api.notion.com/v1").replace(/\/$/, "");
  try {
    const r = await fetchFn(`${base}/databases/${databaseId}`, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export function applyDatabaseSchema(schema, db) {
  const props = (db && db.properties) || {};
  const s = cloneSchema(schema);
  const optNames = (prop) => {
    if (!prop || typeof prop !== "object") return null;
    const bag = prop.select || prop.status || prop.multi_select;
    if (!bag || !Array.isArray(bag.options)) return null;
    const names = bag.options.map((o) => o && o.name).filter(Boolean);
    return names.length ? names : null;
  };
  const titleKey = Object.keys(props).find((k) => props[k] && props[k].type === "title");
  if (titleKey) s.title = titleKey;
  if (props.Status && (props.Status.type === "status" || props.Status.type === "select")) {
    s.status = "Status";
    s.statusType = props.Status.type;
    const names = optNames(props.Status);
    if (names) s.statusValues = names;
  }
  const take = (name, type, field, valuesKey) => {
    if (!(props[name] && props[name].type === type)) return;
    s[field] = name;
    if (!valuesKey) return;
    const names = optNames(props[name]);
    if (names) s[valuesKey] = names;
  };
  take("Owner", "select", "owner", "ownerValues");
  take("Priority", "select", "priority", "priorityValues");
  take("Area", "select", "area", "areaValues");
  take("Section", "select", "section", "sectionValues");
  take("Due", "date", "due");
  if (!(props.Section && (props.Section.type === "select" || props.Section.type === "status"))) s.section = "";
  if (props.Description && props.Description.type === "rich_text") s.notes = "Description";
  else if (props.Notes && props.Notes.type === "rich_text") s.notes = "Notes";
  if (s.defaultArea && !(s.areaValues || []).includes(s.defaultArea) && (s.areaValues || []).length) s.defaultArea = s.areaValues[0];
  return s;
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
  for (const k of ["title", "status", "owner", "due", "priority", "area", "notes", "section", "source"]) if ((a[k] || "") !== (b[k] || "")) return false;
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

export function mergeNotionTasks(tasks, pages, tombstones, { partial, dropSeeds, comments, schema: schemaIn, keepUnseen, tombstoneUnseen } = {}) {
  const tombs = { ...(tombstones || {}) };
  const schema = cloneSchema(schemaIn);
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
    schema.sectionValues = mapped.schema.sectionValues;
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
        if (typeof keepUnseen === "function" && keepUnseen(t)) continue;
        if (tombstoneUnseen !== false) tombs[t.id] = Date.now();
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
  const wantArea = String((task.area || s.defaultArea || "Magpy")).trim();
  const areaFallback = (s.areaValues || []).includes(s.defaultArea) ? s.defaultArea : ((s.areaValues || []).includes("Magpy") ? "Magpy" : wantArea);
  const area = pickValue(s.areaValues, wantArea, areaFallback);
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
  if (s.section) {
    const want = canonicalSection(task.section) || s.defaultSection || "";
    const section = pickValue(s.sectionValues, want, want);
    if (section) props[s.section] = { select: { name: section } };
  }
  return props;
}

// Drop activity and comments whose task is gone. Entries with no taskId (meetings, sync notes) stay.
// A localDirty row is still in the task list, so its "created this task" line stays until the write lands.
export function pruneDetached(db) {
  const ids = new Set();
  for (const t of (db && db.tasks) || []) {
    if (!t) continue;
    if (t.id) ids.add(t.id);
    if (t.notionId) ids.add(t.notionId);
  }
  const activity = ((db && db.activity) || []).filter((a) => !a || !a.taskId || ids.has(a.taskId));
  const comments = { ...((db && db.comments) || {}) };
  for (const id of Object.keys(comments)) if (!ids.has(id)) delete comments[id];
  return { activity, comments };
}

function tagSource(pages, source) {
  return (pages || []).filter(Boolean).map((page) => (page._source === source ? page : { ...page, _source: source }));
}

function queryKind(q, absentOnUnreadable) {
  if (!q || q.configured === false) return "absent";
  if (!q.incomplete) return "ok";
  if (q.pages && q.pages.length) return "partial";
  if (absentOnUnreadable) {
    const err = String(q.error || "");
    if (/not connected|\b404\b|\b403\b|could not find database/i.test(err)) return "absent";
  }
  return "failed";
}

function relocateComments(from, to) {
  if (!from || !to) return;
  const ids = new Set();
  for (const t of to.tasks || []) {
    if (t && t.id) ids.add(t.id);
    if (t && t.notionId) ids.add(t.notionId);
  }
  from.comments ||= {};
  to.comments ||= {};
  for (const id of Object.keys(from.comments)) {
    if (!ids.has(id)) continue;
    if (!to.comments[id]) to.comments[id] = from.comments[id];
    delete from.comments[id];
  }
}

function boardSnapshot(base, notion) {
  return {
    tasks: (base && base.tasks) || [],
    tombstones: (base && base.tombstones) || {},
    comments: { ...((base && base.comments) || {}) },
    activity: ((base && base.activity) || []).slice(),
    notion,
    changed: false,
    dropped: [],
  };
}

// One pull of both databases, then each task is placed on a single board.
// intern/private query kinds: ok, partial (keep unseen from that database), failed (keep the last good rows),
// absent (the Private database contributed nothing, so rows that lived only there are dropped).
export function syncSectionBoards({ magpy, privates, intern, privateQuery, now } = {}) {
  const at = now || Date.now();
  const internKind = queryKind(intern, false);
  const privateKind = queryKind(privateQuery, true);
  const internPages = internKind === "failed" ? [] : tagSource(intern && intern.pages, "magpy");
  const privatePages = privateKind === "ok" || privateKind === "partial" ? tagSource(privateQuery && privateQuery.pages, "privates") : [];
  const magpyPages = [];
  const privatesPages = [];
  for (const page of [...internPages, ...privatePages]) {
    const board = routeSection(sectionValueOf(page), page._source);
    (board === "privates" ? privatesPages : magpyPages).push(page);
  }
  const keepUnseen = (t) => {
    const src = t && t.source === "privates" ? "privates" : "magpy";
    const kind = src === "privates" ? privateKind : internKind;
    return kind === "partial" || kind === "failed";
  };
  const finish = (base, pages, schema, { dropSeeds, error, warning, databaseId, merge }) => {
    if (!merge) {
      return boardSnapshot(base, {
        ...((base && base.notion) || {}),
        syncedAt: at,
        error: error || "",
        warning: warning || ((base && base.notion && base.notion.warning) || ""),
        databaseId: databaseId || ((base && base.notion && base.notion.databaseId) || ""),
        count: ((base && base.tasks) || []).filter((t) => t && t.notionId).length,
      });
    }
    const merged = mergeNotionTasks((base && base.tasks) || [], pages, (base && base.tombstones) || {}, {
      partial: false,
      dropSeeds,
      comments: base && base.comments,
      schema,
      keepUnseen,
      tombstoneUnseen: false,
    });
    return {
      tasks: merged.tasks,
      tombstones: merged.tombstones,
      comments: { ...((base && base.comments) || {}) },
      activity: ((base && base.activity) || []).slice(),
      notion: {
        ...((base && base.notion) || {}),
        syncedAt: at,
        error: error || "",
        warning: warning || "",
        databaseId: databaseId || "",
        schema: merged.schema,
        count: merged.tasks.filter((t) => t.notionId).length,
        droppedLocal: merged.dropped.length ? merged.dropped : (((base && base.notion) && base.notion.droppedLocal) || []),
      },
      changed: merged.changed,
      dropped: merged.dropped,
    };
  };
  const magpyNext = finish(magpy, magpyPages, (magpy && magpy.notion && magpy.notion.schema) || DEFAULT_SCHEMA, {
    merge: internKind !== "failed",
    dropSeeds: internKind === "ok",
    error: internKind === "ok" ? "" : ((intern && intern.error) || "Notion sync failed"),
    warning: (intern && intern.warning) || "",
    databaseId: (intern && intern.databaseId) || "",
  });
  const privateError = privateKind === "ok" ? "" : ((privateQuery && privateQuery.error) || "Not connected. Notion could not read Solavant Private · Tasks.");
  const privNext = finish(privates, privatesPages, (privates && privates.notion && privates.notion.schema) || PRIVATES_SCHEMA, {
    merge: !(internKind === "failed" && privateKind === "failed"),
    dropSeeds: internKind === "ok" || privateKind === "ok" || privateKind === "absent",
    error: privateError,
    warning: (privateQuery && privateQuery.warning) || "",
    databaseId: (privateQuery && privateQuery.databaseId) || "",
  });
  const confident = internKind !== "failed" && privateKind !== "failed";
  if (confident) {
    relocateComments(magpyNext, privNext);
    relocateComments(privNext, magpyNext);
    for (const next of [magpyNext, privNext]) {
      const pruned = pruneDetached(next);
      if (pruned.activity.length !== next.activity.length || Object.keys(pruned.comments).length !== Object.keys(next.comments).length) next.changed = true;
      next.activity = pruned.activity;
      next.comments = pruned.comments;
    }
  }
  return { magpy: magpyNext, privates: privNext };
}

async function notionWrite({ token, apiBase, fetchImpl, method, path, body, label }) {
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
  if (!r.ok) throw new Error(explainHttp(r.status, j && j.message, label));
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
  const label = () => (typeof opts.label === "function" ? opts.label() : opts.label) || "";
  const initialSchema = () => (typeof opts.schema === "function" ? opts.schema() : opts.schema) || null;
  async function run() {
    const token = opts.token();
    const resolve = opts.resolve || resolveDatabaseId;
    const { databaseId, warning } = resolve(opts.databaseId());
    const meta = metaOf();
    meta.databaseId = databaseId;
    meta.warning = warning;
    if (!databaseId) {
      meta.syncedAt = Date.now();
      meta.error = opts.clearWhenUnreadable
        ? `Not connected. ${label() || "This database"} has no database id. Set PRIVATES_NOTION_DATABASE_ID and share Solavant Private · Tasks with the SCM Team integration.`
        : `Notion could not read ${label() || "this database"}. The database id is not set.`;
      const tasks = opts.clearWhenUnreadable ? (state().tasks || []).filter((t) => t && t.localDirty) : state().tasks;
      await opts.commit({ tasks, tombstones: state().tombstones, notion: meta }, { tasksChanged: false });
      return;
    }
    const result = await queryAllPages({ token, databaseId, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, label: label() });
    meta.syncedAt = Date.now();
    const st = state();
    if (result.incomplete && result.pages.length === 0) {
      meta.error = result.error || "Notion sync failed";
      const tasks = opts.clearWhenUnreadable ? (st.tasks || []).filter((t) => t && t.localDirty) : st.tasks;
      const cleared = tasks.length !== (st.tasks || []).length;
      await opts.commit({ tasks, tombstones: st.tombstones, notion: meta }, { tasksChanged: cleared });
      return;
    }
    let schema = initialSchema();
    if (!result.incomplete && opts.loadSchema) {
      const db = await retrieveDatabase({ token, databaseId, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl });
      if (db && db.properties) schema = applyDatabaseSchema(schema, db);
    }
    const merged = mergeNotionTasks(st.tasks, result.pages, st.tombstones, {
      partial: !!result.incomplete,
      dropSeeds: !result.incomplete && (result.pages.length > 0 || !!opts.dropLocalWithoutPages),
      comments: st.comments,
      schema,
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
    const resolve = opts.resolve || resolveDatabaseId;
    const { databaseId } = resolve(opts.databaseId() || meta.databaseId);
    const schema = meta.schema || initialSchema() || DEFAULT_SCHEMA;
    try {
      const j = task.notionId
        ? await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "PATCH", path: `/pages/${task.notionId}`, body: { properties: propertiesForTask(task, schema) }, label: label() })
        : await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "POST", path: "/pages", body: { parent: { database_id: databaseId }, properties: propertiesForTask(task, schema) }, label: label() });
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
      await notionWrite({ token, apiBase: opts.apiBase(), fetchImpl: opts.fetchImpl, method: "PATCH", path: `/pages/${task.notionId}`, body: { archived: true }, label: label() });
      return { error: "" };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }
  return { refresh, pushTask, archiveTask, snap };
}
