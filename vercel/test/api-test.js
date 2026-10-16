const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
async function suite(label, setup) {
  const cleanup = await setup();
  delete require.cache[require.resolve("./harness.js")]; delete require.cache[require.resolve("../lib/kv")]; delete require.cache[require.resolve("../lib/app")]; delete require.cache[require.resolve("../api/[...path].js")];
  const h = require("./harness.js").create(); await new Promise((r) => h.listen(0, r)); const base = "http://localhost:" + h.address().port;
  const call = async (m, u, b, hdr = {}) => { const r = await fetch(base + u, { method: m, headers: { "content-type": "application/json", "x-user": "Ariel", ...hdr }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null), r }; };
  let d = (await call("GET", "/api/data")).j;
  assert.equal(d.tasks.length, 8, "seeded 8"); assert.equal(d.tasks[0].priority, "High"); assert(d.rev >= 1);
  assert.deepEqual((await call("GET", "/api/data?since=" + d.rev)).j, { rev: d.rev, unchanged: true });
  for (const [pr, want] of [["urgent", "Urgent"], ["HIGH", "High"], ["Medium", "Medium"], ["low", "Low"], ["bogus", "Low"]]) {
    const r = await call("PUT", "/api/task", { id: "p-" + pr, title: "t", priority: pr }); assert.equal(r.j.task.priority, want);
  }
  const t = (await call("PUT", "/api/task", { id: "tdoc", title: "Doc task", docs: [{ url: "https://docs.google.com/document/d/1/edit" }, { url: "javascript:alert(1)" }, { url: "nope" }] })).j.task;
  assert.equal(t.docs.length, 1); assert.equal(t.docs[0].addedBy, "Ariel");
  const kept = (await call("PUT", "/api/task", { id: "tdoc", title: "Doc task", updatedAt: Date.now() + 5 })).j.task; assert.equal(kept.docs.length, 1, "docs kept when omitted");
  assert.equal((await call("PUT", "/api/task", { id: "tdoc", title: "old", updatedAt: 1 })).j.applied, false);
  const c = await call("POST", "/api/task/tdoc/comments", { text: "hello", author: "Can" }); assert.equal(c.s, 201); assert.equal(c.j.comment.author, "Can");
  assert.equal((await call("POST", "/api/task/nope/comments", { text: "x" })).s, 404); assert.equal((await call("POST", "/api/task/tdoc/comments", { text: " " })).s, 400);
  assert.equal((await call("PUT", "/api/hours", { key: "Can|2026-10-05", value: 7.5 })).j.applied, true); assert.equal((await call("PUT", "/api/hours", { value: "x" })).s, 400);
  const mt = await call("POST", "/api/meetings", { title: "Sync", start: "2026-10-12T15:00:00Z", end: "2026-10-12T15:30:00Z", attendees: ["a@b.c"], meet: true, reminderMinutes: 10 }); assert.equal(mt.s, 201);
  const mid = mt.j.meeting.id; assert.equal((await call("POST", "/api/meetings", { title: "", start: "x" })).s, 400);
  assert.equal((await call("GET", "/api/meetings/pending")).j.meetings.length, 1);
  assert.equal((await call("POST", `/api/meetings/${mid}/synced`, { googleEventId: "g1", meetLink: "https://meet.google.com/x" })).j.meeting.status, "on calendar");
  assert.equal((await call("PUT", "/api/meetings/" + mid, { title: "Sync 2" })).j.meeting.status, "requested");
  assert.equal((await call("DELETE", "/api/meetings/" + mid)).j.meeting.status, "cancelled");
  assert.equal((await call("GET", "/api/meetings/pending?include=cancelled")).j.meetings.length, 1);
  assert.equal((await call("DELETE", `/api/meetings/${mid}?hard=1`)).j.meeting, null); assert.equal((await call("GET", "/api/meetings/" + mid)).s, 404);
  const a = (await call("POST", "/api/asks", { text: "Need X" })).j.ask; assert.equal(a.status, "new");
  assert.equal((await call("GET", "/api/asks/pending")).j.asks.length, 1);
  assert.equal((await call("POST", `/api/asks/${a.id}/reply`, { reply: "done" })).j.ask.status, "handled"); assert.equal((await call("GET", "/api/asks/pending")).j.asks.length, 0);
  d = (await call("GET", "/api/data")).j; assert(d.activity.some((x) => x.kind === "doc") && d.activity.some((x) => x.kind === "comment") && d.activity.some((x) => x.kind === "meeting"));
  assert.equal(d.hours["Can|2026-10-05"], 7.5);
  assert.equal((await call("DELETE", "/api/task/tdoc?updatedAt=" + (Date.now() + 100))).j.applied, true);
  assert.equal((await call("PUT", "/api/task", { id: "tdoc", title: "zombie", updatedAt: 5 })).j.applied, false);
  await Promise.all(Array.from({ length: 30 }, (_, i) => call("PUT", "/api/task", { id: "c" + i, title: "conc " + i }, { "x-user": ["Myles", "Ariel", "Can"][i % 3] })));
  d = (await call("GET", "/api/data")).j; assert.equal(d.tasks.filter((x) => x.id.startsWith("c")).length, 30, "no lost updates");
  assert.equal((await call("GET", "/api/events")).s, 410); assert.equal((await call("GET", "/api/zzz")).s, 404);
  assert.equal((await call("POST", "/api/reset")).j.ok, true); d = (await call("GET", "/api/data")).j; assert.equal(d.tasks.length, 8); assert.equal(d.asks.length, 1); assert.equal(d.meetings.length, 0);
  assert.deepEqual((await call("GET", "/api/session")).j, { required: false, ok: true });
  process.env.APP_PASSWORD = "pw-test"; process.env.SESSION_SECRET = "s3cret";
  assert.deepEqual((await call("GET", "/api/session")).j, { required: true, ok: false });
  assert.equal((await call("GET", "/api/data")).s, 401); assert.equal((await call("POST", "/api/login", { password: "bad" })).s, 401);
  const ok = await call("POST", "/api/login", { password: "pw-test" }); assert.equal(ok.s, 200);
  const ck = ok.r.headers.get("set-cookie").split(";")[0]; assert(/HttpOnly/.test(ok.r.headers.get("set-cookie")));
  assert.equal((await call("GET", "/api/data", null, { cookie: ck })).s, 200); assert.equal((await call("GET", "/api/session", null, { cookie: ck })).j.ok, true);
  assert.equal((await call("GET", "/api/data", null, { cookie: ck.slice(0, -3) + "xxx" })).s, 401);
  delete process.env.APP_PASSWORD; delete process.env.SESSION_SECRET; assert.equal((await call("GET", "/api/data")).s, 200);
  h.close(); await cleanup && cleanup(); console.log("PASS", label);
}
(async () => {
  await suite("file store", async () => { process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magpy-")); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL; });
  const fu = require("./fake-upstash").create(); await new Promise((r) => fu.srv.listen(0, r));
  await suite("upstash (fake REST, KV_REST_API_* names)", async () => { process.env.KV_REST_API_URL = "http://localhost:" + fu.srv.address().port; process.env.KV_REST_API_TOKEN = "tok"; });
  assert(fu.kv.get("magpy:state")); console.log("upstash calls:", fu.calls()); fu.srv.close();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
