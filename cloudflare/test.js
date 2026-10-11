// Integration test against a running `wrangler dev` (default http://127.0.0.1:8811). Usage: BASE=... [EXPECT_LOGIN=1 PW=...] node test.js
const BASE = process.env.BASE || "http://127.0.0.1:8811", PW = process.env.PW || "", LOGIN = !!process.env.EXPECT_LOGIN;
const assert = require("assert"); let cookie = "";
const call = async (m, p, b, h = {}) => { const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", cookie, ...h }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null), r }; };
async function sse() { const ac = new AbortController(), r = await fetch(BASE + "/api/events", { headers: { cookie }, signal: ac.signal }); const ev = []; (async () => { const rd = r.body.getReader(), d = new TextDecoder(); try { for (;;) { const { value, done } = await rd.read(); if (done) break; ev.push(d.decode(value)); } } catch {} })(); return { ev, close: () => ac.abort(), status: r.status, ct: r.headers.get("content-type") }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const sess = await call("GET", "/api/session"); console.log("session", sess.j);
  if (LOGIN) {
    assert.equal(sess.j.required, true); assert.equal(sess.j.ok, false);
    assert.equal((await call("GET", "/api/data")).s, 401);
    assert.equal((await call("GET", "/api/events")).s, 401);
    assert.equal((await call("POST", "/api/login", { password: "wrong" })).s, 401);
    const l = await call("POST", "/api/login", { password: PW }); assert.equal(l.s, 200); assert(cookie.startsWith("magpy_session="));
    assert.equal((await call("GET", "/api/session")).j.ok, true);
    const saved = cookie; cookie = saved.slice(0, -3) + "AAA"; assert.equal((await call("GET", "/api/data")).s, 401); cookie = saved;
    console.log("login ok");
  } else assert.equal(sess.j.required, false);
  const d0 = (await call("GET", "/api/data")).j; assert(d0.tasks.length >= 8);
  const A = await sse(), B = await sse(); assert.equal(A.status, 200); assert(/event-stream/.test(A.ct));
  const t = { ...d0.tasks[0], title: "Edited by A", status: "Review", priority: "urgent" };
  const put = await call("PUT", "/api/task", { ...t, updatedAt: Date.now() }, { "x-user": "Ariel" }); assert.equal(put.j.applied, true); assert.equal(put.j.task.priority, "Urgent");
  await sleep(500);
  assert(A.ev.join("").includes("event: change") && B.ev.join("").includes("event: change"), "both SSE clients got change");
  assert.equal((await call("GET", "/api/data")).j.tasks.find((x) => x.id === t.id).title, "Edited by A");
  // stale edit rejected
  assert.equal((await call("PUT", "/api/task", { ...t, title: "stale", updatedAt: 1 })).j.applied, false);
  // new task + comment + activity
  const nid = "ttest" + Date.now(); await call("PUT", "/api/task", { id: nid, title: "New", updatedAt: Date.now() }, { "x-user": "Can" });
  const c = await call("POST", `/api/task/${nid}/comments`, { text: "hello" }, { "x-user": "Can" }); assert.equal(c.s, 201);
  assert.equal((await call("POST", `/api/task/${nid}/comments`, { text: "" })).s, 400); assert.equal((await call("POST", `/api/task/nope/comments`, { text: "x" })).s, 404);
  let d = (await call("GET", "/api/data")).j; assert.equal(d.comments[nid].length, 1); assert(d.activity.some((a) => a.kind === "comment") && d.activity.some((a) => a.kind === "created"));
  // hours
  assert.equal((await call("PUT", "/api/hours", { key: "Myles|2026-10-05", value: 12, updatedAt: Date.now() })).j.applied, true);
  assert.equal((await call("PUT", "/api/hours", { key: "x", value: "abc" })).s, 400);
  // meetings
  const mt = await call("POST", "/api/meetings", { title: "Sync", start: "2026-10-12T15:00:00Z", end: "2026-10-12T15:30:00Z", attendees: ["a@b.c"], meet: true, reminderMinutes: 10 }, { "x-user": "Ariel" }); assert.equal(mt.s, 201);
  const mId = mt.j.meeting.id; assert.equal((await call("POST", "/api/meetings", { title: "bad", start: "x", end: "y" })).s, 400);
  assert((await call("GET", "/api/meetings/pending")).j.meetings.some((m) => m.id === mId));
  const sy = await call("POST", `/api/meetings/${mId}/synced`, { googleEventId: "g1", meetLink: "https://meet.google.com/x" }); assert.equal(sy.j.meeting.status, "on calendar");
  assert.equal((await call("PUT", `/api/meetings/${mId}`, { title: "Sync 2" })).j.meeting.status, "requested");
  assert.equal((await call("DELETE", `/api/meetings/${mId}`)).j.meeting.status, "cancelled");
  assert.equal((await call("DELETE", `/api/meetings/${mId}?hard=1`)).j.meeting, null); assert.equal((await call("GET", `/api/meetings/${mId}`)).s, 404);
  // asks
  const ak = await call("POST", "/api/asks", { text: "move memo to Review" }, { "x-user": "Myles" }); assert.equal(ak.s, 201);
  assert((await call("GET", "/api/asks/pending")).j.asks.some((a) => a.id === ak.j.ask.id));
  assert.equal((await call("POST", `/api/asks/${ak.j.ask.id}/reply`, { reply: "done" })).j.ask.status, "handled");
  // delete task w/ tombstone
  assert.equal((await call("DELETE", `/api/task/${nid}?updatedAt=${Date.now()}`)).j.applied, true);
  d = (await call("GET", "/api/data")).j; assert(!d.tasks.some((x) => x.id === nid) && !d.comments[nid]);
  assert.equal((await call("GET", "/api/nope")).s, 404);
  // static
  const idx = await fetch(BASE + "/"); assert.equal(idx.status, 200); assert(/<html/i.test(await idx.text()));
  for (const f of ["/app.js", "/store.js", "/style.css", "/fonts/inter.woff2"]) assert.equal((await fetch(BASE + f)).status, 200, f);
  A.close(); B.close();
  if (LOGIN) { await call("POST", "/api/logout"); cookie = ""; assert.equal((await call("GET", "/api/data")).s, 401); }
  console.log("ALL OK");
  require("fs").writeFileSync(process.env.SNAP || "/tmp/snap.json", JSON.stringify({ tasks: d.tasks.length, title: d.tasks.find((x) => x.id === t.id).title, asks: d.asks.length, hours: d.hours }));
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
