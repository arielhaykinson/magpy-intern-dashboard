// Docs API test. Usage: BASE=http://127.0.0.1:PORT node docs-test.js  (works against both server.js and the Worker)
const BASE = process.env.BASE || "http://127.0.0.1:8765", assert = require("assert");
const call = async (m, p, b, h = {}) => { const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
(async () => {
  const id = "tdocs" + Date.now(), H = { "x-user": "Tester" }, put = (o) => call("PUT", "/api/task", { id, title: "Docs test", updatedAt: Date.now(), ...o }, H);
  let r = await put({}); assert.deepEqual(r.j.task.docs, []);
  r = await put({ docs: [{ url: "https://docs.google.com/document/d/1/edit", title: " Memo " }, { url: "javascript:alert(1)" }, { url: "ftp://x/y" }, { url: "nonsense" }, { url: "https://example.com/a" }] });
  assert.equal(r.j.task.docs.length, 2); assert.equal(r.j.task.docs[0].title, "Memo"); assert.equal(r.j.task.docs[0].addedBy, "Tester"); assert(r.j.task.docs[0].addedAt && r.j.task.docs[0].id);
  const keep = r.j.task.docs;
  r = await put({ title: "renamed" }); assert.deepEqual(r.j.task.docs, keep, "omitting docs keeps them");
  r = await put({ docs: keep.slice(0, 1) }); assert.equal(r.j.task.docs.length, 1);
  r = await put({ docs: Array.from({ length: 30 }, (_, i) => ({ url: "https://e.com/" + i })) }); assert.equal(r.j.task.docs.length, 20);
  const d = (await call("GET", "/api/data")).j; assert.equal(d.tasks.find((t) => t.id === id).docs.length, 20);
  assert(d.activity.some((a) => a.taskId === id && a.kind === "doc" && /attached a doc/.test(a.text)), "activity logged");
  assert.equal((await call("DELETE", `/api/task/${id}?updatedAt=${Date.now() + 5}`)).j.applied, true);
  console.log("docs API OK");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
