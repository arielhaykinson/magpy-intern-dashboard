import assert from "assert";
import http from "http";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { queryAllPages, mergeNotionTasks, mapPage, resolveDatabaseId, propertiesForTask, tasksForView, routeSection, syncSectionBoards, INTERN_TASKS_DATABASE_ID, PRIVATES_TASKS_DATABASE_ID, STALE_MIRROR_DATABASE_ID, DEFAULT_SCHEMA } from "./notion-sync.mjs";

const page = (id, title, extra = {}) => ({
  id, url: "https://www.notion.so/" + id, archived: false,
  last_edited_time: extra.edited || "2026-10-21T19:00:00.000Z",
  properties: {
    Title: { type: "title", title: [{ plain_text: title }] },
    Status: { type: "select", select: extra.status ? { name: extra.status } : null },
    Owner: { type: "select", select: extra.owner ? { name: extra.owner } : null },
    Priority: { type: "select", select: extra.priority ? { name: extra.priority } : { name: "Medium" } },
    Area: { type: "select", select: { name: extra.area || "Magpy" } },
    Due: { type: "date", date: extra.due ? { start: extra.due } : null },
    Description: { type: "rich_text", rich_text: extra.notes ? [{ plain_text: extra.notes }] : [] },
    Brief: { type: "url", url: extra.brief || null },
  },
});

const mirror = resolveDatabaseId(STALE_MIRROR_DATABASE_ID);
assert.equal(mirror.databaseId, INTERN_TASKS_DATABASE_ID);
assert(mirror.warning.includes("stale"));
assert.equal(resolveDatabaseId("").databaseId, INTERN_TASKS_DATABASE_ID);
assert.equal(INTERN_TASKS_DATABASE_ID, "057cf17c94bb4acf988f926775660ab8");
assert.equal(resolveDatabaseId("057cf17c-94bb-4acf-988f-926775660ab8").databaseId, INTERN_TASKS_DATABASE_ID);
assert.equal(resolveDatabaseId("66707f68-2145-40aa-bdbc-3c14ccacc623").databaseId, "66707f68214540aabdbc3c14ccacc623");

const named = mapPage({ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", last_edited_time: "2026-10-21T19:00:00.000Z", properties: { Name: { type: "title", title: [{ plain_text: "From Name" }] }, Status: { type: "select", select: { name: "In progress" } } } });
assert.equal(named.task.title, "From Name");
assert.equal(named.task.status, "In Progress");
assert.equal(named.schema.title, "Name");

const mapped = mapPage(page("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Natrion: source list for the memo and model", { status: "In progress", owner: "", priority: "High", due: "2026-10-22", notes: "Myles edited the brief", brief: "https://example.com/brief" }));
assert.equal(mapped.task.status, "In Progress");
assert.equal(mapped.task.owner, "Unassigned");
assert.equal(mapped.task.due, "2026-10-22");
assert.equal(mapped.task.docs[0].url, "https://example.com/brief");

const props = propertiesForTask({ title: "T", status: "Open", owner: "Unassigned", priority: "Urgent", area: "Solavant", due: "2026-10-22", notes: "n" }, DEFAULT_SCHEMA);
assert.equal(props.Status.status.name, "Not started");
assert.equal(props.Status.select, undefined);
assert.equal(props.Owner.select, null);
assert.equal(props.Priority.select.name, "High");
assert.equal(props.Area.select.name, "Solavant");
assert.equal(props["Task name"].title[0].text.content, "T");
assert.equal(props.Description, undefined);
assert.equal(props.Title, undefined);
assert.equal(props.Section.select.name, "Magpy");
assert.equal(propertiesForTask({ title: "T", status: "Open", section: "Private" }, DEFAULT_SCHEMA).Section.select.name, "Private");
assert.equal(routeSection("Private", "magpy"), "privates");
assert.equal(routeSection("magpy", "privates"), "magpy");
assert.equal(routeSection("", "magpy"), "magpy");
assert.equal(routeSection("  ", "privates"), "privates");
assert.equal(routeSection("nope", "privates"), "privates");
assert.equal(routeSection("nope", "magpy"), "magpy");

const selectSchema = { ...DEFAULT_SCHEMA, title: "Title", statusType: "select", notes: "Description", brief: "Brief", statusValues: ["Open", "In progress", "Review", "Done"] };
const selectProps = propertiesForTask({ title: "T", status: "In Progress", owner: "Unassigned", priority: "Urgent", area: "Magpy", due: "2026-10-22", notes: "n" }, selectSchema);
assert.equal(selectProps.Status.select.name, "In progress");
assert.equal(selectProps.Title.title[0].text.content, "T");
assert.equal(selectProps.Description.rich_text[0].text.content, "n");

const solavant = mapPage({
  id: "cccccccccccccccccccccccccccccccc",
  last_edited_time: "2026-10-21T19:00:00.000Z",
  properties: {
    "Task name": { type: "title", title: [{ plain_text: "File the memo" }] },
    Status: { type: "status", status: { name: "Not started" } },
    Owner: { type: "select", select: { name: "Myles" } },
    Priority: { type: "select", select: { name: "High" } },
    Area: { type: "select", select: { name: "Solavant" } },
    Due: { type: "date", date: { start: "2026-10-24" } },
    Archived: { type: "checkbox", checkbox: false },
  },
});
assert.equal(solavant.task.title, "File the memo");
assert.equal(solavant.task.status, "Open");
assert.equal(solavant.task.owner, "Myles");
assert.equal(solavant.task.area, "Solavant");
assert.equal(solavant.task.due, "2026-10-24");
assert.equal(solavant.schema.title, "Task name");
assert.equal(solavant.schema.statusType, "status");
assert.equal(solavant.schema.notes, "");
const solavantWrite = propertiesForTask({ ...solavant.task, status: "In Progress", notes: "stays on the dashboard" }, solavant.schema);
assert.equal(solavantWrite.Status.status.name, "In progress");
assert.equal(solavantWrite["Task name"].title[0].text.content, "File the memo");
assert.equal(solavantWrite.Description, undefined);
const hidden = mergeNotionTasks([], [{
  id: "dddddddddddddddddddddddddddddddd", archived: false,
  properties: { "Task name": { type: "title", title: [{ plain_text: "Hidden row" }] }, Status: { type: "status", status: { name: "Done" } }, Archived: { type: "checkbox", checkbox: true } },
}], {}, { dropSeeds: false });
assert.equal(hidden.tasks.length, 0);

const seeds = [{ id: "seed1", title: "Natrion source list", status: "Open", owner: "Unassigned", due: "", priority: "High", area: "Magpy", notes: "", updatedAt: Date.now() }];
const localEdit = { id: "abc", notionId: "abc", title: "dashboard edit", status: "Open", owner: "Ariel", due: "", priority: "High", area: "Magpy", notes: "", docs: [], localDirty: true, localEditedAt: Date.parse("2026-10-21T21:00:00.000Z"), notionEdited: "2026-10-21T18:00:00.000Z", updatedAt: Date.parse("2026-10-21T21:00:00.000Z") };
const kept = mergeNotionTasks([...seeds, localEdit], [page("abc", "older notion title", { status: "Open", owner: "Ariel", edited: "2026-10-21T19:00:00.000Z" })], {}, { dropSeeds: true });
assert(!kept.tasks.some((t) => t.title === "Natrion source list"), "untouched starter rows are not the board");
assert.equal(kept.tasks.find((t) => t.notionId === "abc").title, "dashboard edit");
const localOnly = mergeNotionTasks([
  ...seeds,
  { id: "hi", title: "hi", status: "Open", owner: "Can", due: "", priority: "Low", area: "Magpy", notes: "", docs: [] },
  { id: "model", title: "Finish the model template/foundation for all SPC work", status: "Open", owner: "Myles", due: "", priority: "Medium", area: "Magpy", notes: "", docs: [] },
  { id: "pending", title: "A real new task", status: "Open", owner: "Ariel", due: "2026-10-30", priority: "High", area: "Magpy", notes: "", docs: [], localDirty: true, localEditedAt: Date.now() },
], [page("abc", "From Notion", { status: "Open", owner: "Can" })], {}, { dropSeeds: true });
assert.deepEqual(localOnly.dropped.slice().sort(), ["Finish the model template/foundation for all SPC work", "Natrion source list", "hi"]);
assert(!localOnly.tasks.some((t) => t.title === "hi" || t.title.startsWith("Finish the model")));
assert(localOnly.tasks.some((t) => t.title === "A real new task" && t.localDirty && !t.notionId));
assert(localOnly.tasks.some((t) => t.notionId === "abc"));
const shown = tasksForView(localOnly.tasks, true);
assert(!shown.some((t) => !t.notionId && !t.localDirty));
assert.equal(tasksForView(localOnly.tasks, false).length, localOnly.tasks.length);
const mylesWins = mergeNotionTasks(kept.tasks, [page("abc", "Myles updated the title", { status: "Review", owner: "Myles", edited: "2026-10-21T22:00:00.000Z" })], {}, { dropSeeds: true });
assert.equal(mylesWins.tasks.find((t) => t.notionId === "abc").title, "Myles updated the title");
assert.equal(mylesWins.tasks.find((t) => t.notionId === "abc").status, "Review");
assert.equal(mylesWins.tasks.find((t) => t.notionId === "abc").owner, "Myles");

let calls = 0;
const paged = await queryAllPages({
  token: "t", databaseId: INTERN_TASKS_DATABASE_ID,
  fetchImpl: async (url, opt) => {
    calls++;
    const body = JSON.parse(opt.body);
    assert.equal(body.page_size, 100);
    assert(url.includes("/databases/" + INTERN_TASKS_DATABASE_ID + "/query"));
    if (!body.start_cursor) return { ok: true, status: 200, text: async () => JSON.stringify({ results: Array.from({ length: 100 }, (_, i) => page("p" + i, "Row " + i)), has_more: true, next_cursor: "c2" }) };
    assert.equal(body.start_cursor, "c2");
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [page("myles", "Myles moved this to Review", { status: "In progress", owner: "Myles" })], has_more: false, next_cursor: null }) };
  },
});
assert.equal(calls, 2);
assert.equal(paged.pages.length, 101);
assert.equal(paged.incomplete, false);
const merged = mergeNotionTasks(seeds, paged.pages, {}, { dropSeeds: true });
assert.equal(merged.tasks.length, 101);
assert.equal(merged.tasks.find((t) => t.notionId === "myles").status, "In Progress");
assert.equal(merged.tasks.find((t) => t.notionId === "myles").owner, "Myles");

const partial = await queryAllPages({
  token: "t", databaseId: "x",
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [page("only", "Only page")], has_more: true }) }),
});
assert.equal(partial.incomplete, true);
const survived = mergeNotionTasks([{ id: "keep", notionId: "keep", title: "still here", status: "Open", owner: "Can", due: "", priority: "Low", area: "Magpy", notes: "", docs: [] }], partial.pages, {}, { partial: true, dropSeeds: false });
assert(survived.tasks.some((t) => t.notionId === "keep"), "a partial page must not drop tasks Notion has not sent yet");

const hiId = "tmv76tnl15qyl";
const taggedId = "22222222222222222222222222222222";
const routed = syncSectionBoards({
  magpy: {
    tasks: [
      { id: hiId, title: "hi", status: "Open", owner: "Can", due: "", priority: "Low", area: "Magpy", notes: "", docs: [] },
      { id: "pending", title: "A real new task", status: "Open", owner: "Ariel", due: "", priority: "High", area: "Magpy", notes: "", docs: [], localDirty: true },
    ],
    activity: [
      { taskId: hiId, title: "hi", text: "created this task" },
      { taskId: "", title: "Weekly", text: "requested a meeting" },
      { taskId: "pending", title: "A real new task", text: "created this task" },
    ],
    comments: { [hiId]: [{ text: "stale" }], pending: [{ text: "keep" }], [taggedId]: [{ text: "moves" }] },
    tombstones: {},
    notion: {},
  },
  privates: {
    tasks: [{ id: "oldpriv", notionId: "oldpriv", source: "privates", title: "Old private only", status: "Open", owner: "Ariel", due: "", priority: "Low", area: "Solavant Private", notes: "", docs: [] }],
    activity: [{ taskId: "oldpriv", title: "Old private only", text: "created this task" }],
    comments: { oldpriv: [{ text: "gone" }] },
    tombstones: {},
    notion: {},
  },
  intern: {
    pages: [
      { id: "11111111111111111111111111111111", last_edited_time: "2026-10-22T12:00:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Stay on Magpy" }] }, Status: { type: "status", status: { name: "Not started" } }, Section: { type: "select", select: null } } },
      { id: taggedId, last_edited_time: "2026-10-22T12:00:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Route me" }] }, Status: { type: "status", status: { name: "In progress" } }, Section: { type: "select", select: { name: "Private" } } } },
    ],
    error: "", incomplete: false, configured: true, databaseId: INTERN_TASKS_DATABASE_ID,
  },
  privateQuery: { pages: [], error: "Not connected. Notion could not read Solavant Private · Tasks (404).", incomplete: true, configured: true, databaseId: PRIVATES_TASKS_DATABASE_ID },
});
assert(routed.magpy.tasks.some((t) => t.title === "Stay on Magpy"));
assert(!routed.magpy.tasks.some((t) => t.title === "Route me" || t.title === "hi" || t.title === "Old private only"));
assert(routed.magpy.tasks.some((t) => t.title === "A real new task" && t.localDirty && !t.notionId));
assert(!routed.magpy.activity.some((a) => a.title === "hi" || a.taskId === hiId));
assert(routed.magpy.activity.some((a) => a.text === "requested a meeting"));
assert(routed.magpy.activity.some((a) => a.taskId === "pending"));
assert(!routed.magpy.comments[hiId]);
assert(routed.magpy.comments.pending);
assert.equal(routed.magpy.notion.error, "");
assert(routed.privates.tasks.some((t) => t.title === "Route me" && t.section === "Private"));
assert(!routed.privates.tasks.some((t) => t.title === "Stay on Magpy" || t.title === "Old private only" || t.title === "hi"));
assert.equal(routed.privates.comments[taggedId][0].text, "moves");
assert(!routed.privates.activity.some((a) => a.title === "Old private only"));
assert.match(routed.privates.notion.error, /Not connected/);
const back = syncSectionBoards({
  magpy: routed.magpy,
  privates: routed.privates,
  intern: {
    pages: [
      { id: "11111111111111111111111111111111", last_edited_time: "2026-10-22T12:05:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Stay on Magpy" }] }, Status: { type: "status", status: { name: "Not started" } }, Section: { type: "select", select: null } } },
      { id: taggedId, last_edited_time: "2026-10-22T12:05:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Route me" }] }, Status: { type: "status", status: { name: "In progress" } }, Section: { type: "select", select: null } } },
    ],
    error: "", incomplete: false, configured: true, databaseId: INTERN_TASKS_DATABASE_ID,
  },
  privateQuery: {
    pages: [
      { id: "33333333333333333333333333333333", last_edited_time: "2026-10-22T12:05:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Lives on Private" }] }, Status: { type: "status", status: { name: "Not started" } }, Section: { type: "select", select: null } } },
      { id: "44444444444444444444444444444444", last_edited_time: "2026-10-22T12:05:00.000Z", properties: { "Task name": { type: "title", title: [{ plain_text: "Tagged back to Magpy" }] }, Status: { type: "status", status: { name: "Not started" } }, Section: { type: "select", select: { name: "Magpy" } } } },
    ],
    error: "", incomplete: false, configured: true, databaseId: PRIVATES_TASKS_DATABASE_ID,
  },
});
assert(back.magpy.tasks.some((t) => t.title === "Route me"), "clearing Section sends an Interns row back to Magpy");
assert(back.magpy.tasks.some((t) => t.title === "Tagged back to Magpy"));
assert(!back.magpy.tasks.some((t) => t.title === "Lives on Private"));
assert(!back.privates.tasks.some((t) => t.title === "Route me" || t.title === "Tagged back to Magpy"));
assert(back.privates.tasks.some((t) => t.title === "Lives on Private"));
assert.equal(back.privates.notion.error, "");
assert(back.magpy.tasks.some((t) => t.title === "A real new task" && t.localDirty));
const failed = syncSectionBoards({
  magpy: { tasks: [{ id: "a", notionId: "a", source: "magpy", title: "keep me", status: "Open", owner: "Can", due: "", priority: "Low", area: "Magpy", notes: "", docs: [] }], activity: [{ taskId: "a", title: "keep me", text: "created this task" }], comments: {}, tombstones: {}, notion: {} },
  privates: { tasks: [], activity: [], comments: {}, tombstones: {}, notion: {} },
  intern: { pages: [], error: "Could not reach Notion: timeout", incomplete: true, configured: true, databaseId: INTERN_TASKS_DATABASE_ID },
  privateQuery: { pages: [], error: "Not connected. Notion could not read Solavant Private · Tasks (404).", incomplete: true, configured: true, databaseId: PRIVATES_TASKS_DATABASE_ID },
});
assert.equal(failed.magpy.tasks[0].title, "keep me");
assert(failed.magpy.activity.some((a) => a.taskId === "a"));
assert.match(failed.magpy.notion.error, /timeout/);

const worker = fs.readFileSync(path.join("cloudflare", "src", "index.js"), "utf8");
const server = fs.readFileSync("server.js", "utf8");
for (const src of [worker, server]) {
  assert(src.includes("/api/notion/refresh"));
  assert(src.includes("notion"));
}
assert(worker.includes("createNotionSync"));
assert(worker.includes("x-cfg-notion"));
assert(server.includes("notion-sync.mjs"));
const vercelApp = fs.readFileSync(path.join("vercel", "lib", "app.js"), "utf8");
assert(vercelApp.includes("/api/notion/refresh"));
assert(vercelApp.includes("notion-sync.mjs"));

function mockNotion(pages, seen) {
  return http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => b += c); req.on("end", () => {
      seen.push({ url: req.url, method: req.method, body: b ? JSON.parse(b) : null });
      const id = (req.url.match(/databases\/([^/]+)\/query/) || [])[1];
      if (req.method === "POST" && id) {
        if (id === STALE_MIRROR_DATABASE_ID) { res.writeHead(404); return res.end(JSON.stringify({ message: "mirror" })); }
        const body = JSON.parse(b || "{}");
        const start = body.start_cursor === "c2" ? 100 : 0;
        const slice = pages.slice(start, start + 100);
        const more = start + 100 < pages.length;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ results: slice, has_more: more, next_cursor: more ? "c2" : null }));
      }
      const pid = (req.url.match(/\/pages\/([^/?]+)/) || [])[1];
      if (req.method === "PATCH" && pid) {
        const body = JSON.parse(b || "{}");
        const row = pages.find((p) => p.id.replace(/-/g, "") === pid.replace(/-/g, ""));
        if (row && body.properties && body.properties.Status && body.properties.Status.select) row.properties.Status.select = { name: body.properties.Status.select.name };
        if (row && body.properties && body.properties.Title) row.properties.Title.title = [{ plain_text: body.properties.Title.title[0].text.content }];
        row.last_edited_time = "2026-10-21T22:30:00.000Z";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: pid, last_edited_time: row.last_edited_time, url: row.url }));
      }
      res.writeHead(404); res.end("{}");
    });
  });
}

const pages = Array.from({ length: 100 }, (_, i) => page("row" + String(i).padStart(8, "0"), "Row " + i, { status: "Open" }));
pages.push(page("mylespage00000000000000000001", "Myles moved this to Review", { status: "In progress", owner: "Myles", priority: "High", due: "2026-10-22", notes: "changed on the Intern Tasks board" }));
const seen = [];
const mock = mockNotion(pages, seen);
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const api = "http://127.0.0.1:" + mock.address().port + "/v1";
const dir = fs.mkdtempSync("/tmp/magpy-notion-");
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: "8877", DATA_DIR: dir, NOTION_TOKEN: "secret-token", NOTION_API_BASE: api, NOTION_DATABASE_ID: STALE_MIRROR_DATABASE_ID, NOTION_SYNC_MS: "60000", APP_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = ""; child.stdout.on("data", (d) => logs += d); child.stderr.on("data", (d) => logs += d);
const base = "http://127.0.0.1:8877";
const wait = async () => { for (let i = 0; i < 50; i++) { try { const r = await fetch(base + "/api/data"); if (r.ok) return r; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error("server did not start\n" + logs); };
try {
  const first = await (await wait()).json();
  assert.equal(first.notion.configured, true);
  assert.equal(first.notion.databaseId, INTERN_TASKS_DATABASE_ID);
  assert(first.notion.warning.includes("stale"));
  assert.equal(first.tasks.filter((t) => t.notionId).length, 101);
  assert(!first.tasks.some((t) => t.title === "Natrion source list"));
  const mine = first.tasks.find((t) => t.title === "Myles moved this to Review");
  assert(mine, "task past the first 100 Notion rows is on the dashboard");
  assert.equal(mine.status, "In Progress");
  assert.equal(mine.owner, "Myles");
  assert.equal(mine.due, "2026-10-22");
  assert(seen.some((s) => s.url.includes(INTERN_TASKS_DATABASE_ID)));
  assert(!seen.some((s) => s.url.includes(STALE_MIRROR_DATABASE_ID)));

  pages[100].properties.Title.title = [{ plain_text: "Myles updated the title" }];
  pages[100].last_edited_time = "2026-10-21T21:10:00.000Z";
  const cached = await (await fetch(base + "/api/data")).json();
  assert(cached.tasks.some((t) => t.title === "Myles moved this to Review"), "a fresh cache does not pretend to be live");
  const refreshed = await (await fetch(base + "/api/notion/refresh", { method: "POST" })).json();
  assert.equal(refreshed.ok, true, refreshed.error);
  const after = await (await fetch(base + "/api/data")).json();
  const updated = after.tasks.find((t) => t.notionId === mine.notionId);
  assert.equal(updated.title, "Myles updated the title");
  assert(after.activity.some((a) => /Solavant Interns/.test(a.text)));

  const put = await (await fetch(base + "/api/task", { method: "PUT", headers: { "content-type": "application/json", "x-user": "Ariel" }, body: JSON.stringify({ ...updated, status: "In Progress", updatedAt: Date.now() }) })).json();
  assert.equal(put.applied, true);
  assert.equal(put.notionError, "");
  const patch = seen.filter((s) => s.method === "PATCH").pop();
  assert(patch, "dashboard edit is written back to Notion");
  assert.equal(patch.body.properties.Status.select.name, "In progress");
  assert.equal(patch.body.properties.Title.title[0].text.content, "Myles updated the title");

  const offDir = fs.mkdtempSync("/tmp/magpy-off-");
  const off = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: "8878", DATA_DIR: offDir, APP_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const offBase = "http://127.0.0.1:8878";
  for (let i = 0; i < 50; i++) { try { const r = await fetch(offBase + "/api/data"); if (r.ok) { const j = await r.json(); assert.equal(j.notion.configured, false); assert(j.tasks.length >= 8); const st = await (await fetch(offBase + "/api/notion/refresh", { method: "POST" })).json(); assert.equal(st.configured, false); break; } } catch {} if (i === 49) throw new Error("offline server"); await new Promise((r) => setTimeout(r, 100)); }
  off.kill("SIGTERM");
  console.log("NOTION SYNC OK");
} finally {
  child.kill("SIGTERM");
  mock.close();
}
