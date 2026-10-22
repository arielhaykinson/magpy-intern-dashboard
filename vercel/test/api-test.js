const assert = require("assert"), fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
async function suite(label, setup) {
  delete process.env.NOTION_TOKEN; delete process.env.NOTION_API_BASE; delete process.env.VERCEL;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.ALLOWED_EMAILS; delete process.env.PUBLIC_URL; delete process.env.SYNC_KEY;
  const cleanup = await setup();
  delete require.cache[require.resolve("./harness.js")]; delete require.cache[require.resolve("../lib/kv")]; delete require.cache[require.resolve("../lib/app")]; delete require.cache[require.resolve("../api/[...path].js")];
  const h = require("./harness.js").create(); await new Promise((r) => h.listen(0, r)); const base = "http://localhost:" + h.address().port;
  const call = async (m, u, b, hdr = {}) => { const r = await fetch(base + u, { method: m, headers: { "content-type": "application/json", "x-user": "Ariel", ...hdr }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null), r }; };
  let d = (await call("GET", "/api/data")).j;
  assert.equal(d.tasks.length, 8, "seeded 8"); assert.equal(d.tasks[0].priority, "High"); assert(d.rev >= 1);
  assert.equal(d.notion.configured, false);
  assert.equal((await call("POST", "/api/notion/refresh")).j.configured, false);
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
function notionPage(title, status, owner, edited) {
  return {
    id: "mylespage00000000000000000001", url: "https://www.notion.so/myles", archived: false,
    last_edited_time: edited || "2026-10-21T19:00:00.000Z",
    properties: {
      Title: { type: "title", title: [{ plain_text: title }] },
      Status: { type: "select", select: status ? { name: status } : null },
      Owner: { type: "select", select: owner ? { name: owner } : null },
      Priority: { type: "select", select: { name: "High" } },
      Area: { type: "select", select: { name: "Magpy" } },
      Due: { type: "date", date: null },
      Description: { type: "rich_text", rich_text: [] },
    },
  };
}
async function notionSuite() {
  delete process.env.VERCEL; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const pages = [notionPage("Myles moved this to Review", "Review", "Myles")];
  const seen = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => b += c); req.on("end", () => {
      seen.push({ url: req.url, method: req.method, body: b ? JSON.parse(b) : null });
      if (req.method === "POST" && /\/databases\/[^/]+\/query$/.test(req.url)) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ results: pages, has_more: false, next_cursor: null }));
      }
      if (req.method === "PATCH" && /\/pages\//.test(req.url)) {
        const title = req.url.includes("archived") ? null : (((JSON.parse(b).properties || {}).Title || {}).title || [])[0];
        if (title && title.text) pages[0].properties.Title.title[0].plain_text = title.text.content;
        pages[0].last_edited_time = "2026-10-21T20:00:00.000Z";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: pages[0].id, url: pages[0].url, last_edited_time: pages[0].last_edited_time }));
      }
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  process.env.NOTION_TOKEN = "test-token";
  process.env.NOTION_API_BASE = "http://127.0.0.1:" + mock.address().port + "/v1";
  process.env.NOTION_SYNC_MS = "60000";
  delete process.env.NOTION_DATABASE_ID;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magpy-notion-"));
  delete require.cache[require.resolve("./harness.js")]; delete require.cache[require.resolve("../lib/kv")]; delete require.cache[require.resolve("../lib/app")]; delete require.cache[require.resolve("../api/[...path].js")];
  const h = require("./harness.js").create(); await new Promise((r) => h.listen(0, r)); const base = "http://localhost:" + h.address().port;
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { "content-type": "application/json", "x-user": "Ariel" }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
  let d = (await call("GET", "/api/data")).j;
  assert.equal(d.notion.configured, true); assert.equal(d.notion.ok, true);
  assert.equal(d.tasks.length, 1, "starter rows are replaced by Intern Tasks");
  assert.equal(d.tasks[0].title, "Myles moved this to Review"); assert.equal(d.tasks[0].owner, "Myles"); assert.equal(d.tasks[0].status, "Review");
  assert.deepEqual((await call("GET", "/api/data?since=" + d.rev)).j, { rev: d.rev, unchanged: true });
  pages[0] = notionPage("Myles updated the title", "Review", "Myles", "2026-10-21T19:30:00.000Z");
  d = (await call("GET", "/api/data")).j;
  assert.equal(d.tasks[0].title, "Myles moved this to Review", "a fresh cache must not hide a Notion edit until the interval or a manual refresh");
  const refreshed = await call("POST", "/api/notion/refresh");
  assert.equal(refreshed.s, 200); assert.equal(refreshed.j.ok, true); assert.equal(refreshed.j.count, 1);
  d = (await call("GET", "/api/data")).j;
  assert.equal(d.tasks[0].title, "Myles updated the title");
  const edited = await call("PUT", "/api/task", { ...d.tasks[0], title: "Edited on the dashboard", updatedAt: Date.now() });
  assert.equal(edited.j.applied, true); assert.equal(edited.j.notionError, "");
  assert(seen.some((s) => s.method === "PATCH" && s.url.includes("/pages/")));
  h.close(); mock.close();
  delete process.env.NOTION_TOKEN; delete process.env.NOTION_API_BASE;
  console.log("PASS notion sync");
}
function portalFiles() {
  const crypto = require("crypto");
  const root = path.join(__dirname, "..", "..");
  const expect = {
    "portal/index.html": "98316505afa4f226ab0497ac9b9aee123b337105",
    "portal/login.html": "a63f4407a0f650e7979b1676f5522e21ea5e9f2f",
    "portal/magpy/index.html": "484b2e477740123f02df72916cb297c22793c6e9",
    "portal/solavant-logo.jpg": "1c2d9013c9b9c81d280c560dcc73e1e9c90fd313",
    "middleware.js": "468c293be7fdda85aea19abcf47f0a4b98883a66",
    "vercel/lib/gauth.js": "28ca20bca73cfe95fa0934597653a92f435fd276",
    "vercel/public/style.css": "90cb8727578b2be0c0fa3d61474ecb59d3532de6",
  };
  for (const [rel, sha] of Object.entries(expect)) {
    const buf = fs.readFileSync(path.join(root, rel));
    assert.equal(crypto.createHash("sha1").update(buf).digest("hex"), sha, rel);
  }
  assert.match(fs.readFileSync(path.join(root, "portal/index.html"), "utf8"), /href="\/magpy\/"/);
  assert.match(fs.readFileSync(path.join(root, "portal/index.html"), "utf8"), /href="\/privates\/"/);
  const logo = fs.readFileSync(path.join(root, "portal/privates/logo.png"));
  assert.ok(logo.length > 1000);
  const privCss = fs.readFileSync(path.join(root, "portal/privates/style.css"), "utf8");
  assert.match(privCss, /#C8601F/);
  assert.match(privCss, /#C9A24A/);
  assert.match(privCss, /--bg:#1c1c1e/);
  assert.doesNotMatch(privCss, /#faf8f4|#6b8f7c|#ffffff|background:#fff/);
  const privApp = fs.readFileSync(path.join(root, "portal/privates/app.js"), "utf8");
  const privStore = fs.readFileSync(path.join(root, "portal/privates/store.js"), "utf8");
  assert.doesNotMatch(privApp + privStore, /\/api\/data|\/api\/task|\/api\/notion/);
  assert.match(privStore, /Placeholder/);
  assert.match(fs.readFileSync(path.join(root, "portal/login.html"), "utf8"), /Sign in with Google/);
  assert.match(fs.readFileSync(path.join(root, "middleware.js"), "utf8"), /solavant_session/);
  require(path.join(__dirname, "..", "copy-public.js"));
  const built = path.join(root, "public");
  assert.match(fs.readFileSync(path.join(built, "index.html"), "utf8"), /Our home base/);
  assert.match(fs.readFileSync(path.join(built, "magpy/index.html"), "utf8"), /Solavant home/);
  assert.match(fs.readFileSync(path.join(built, "app.js"), "utf8"), /refreshNotion/);
  assert.match(fs.readFileSync(path.join(built, "app.js"), "utf8"), /By owner/);
  assert.match(fs.readFileSync(path.join(built, "style.css"), "utf8"), /--bg:#faf8f4/);
  assert.match(fs.readFileSync(path.join(built, "privates/index.html"), "utf8"), /Solavant Private Capital/);
  assert.match(fs.readFileSync(path.join(built, "privates/style.css"), "utf8"), /--bg:#1c1c1e/);
  assert.match(fs.readFileSync(path.join(built, "magpy/index.html"), "utf8"), /\/style\.css\?v=18/);
  assert.match(fs.readFileSync(path.join(built, "login.html"), "utf8"), /\/api\/auth\/login/);
  console.log("PASS portal files");
}
function b64urlJson(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
async function googleSuite() {
  delete process.env.NOTION_TOKEN; delete process.env.NOTION_API_BASE; delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.APP_PASSWORD; delete process.env.PUBLIC_URL;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magpy-google-"));
  process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.SESSION_SECRET = "google-session-secret-32bytes-min";
  process.env.ALLOWED_EMAILS = "ariel@solavant.com @solavant.com";
  for (const k of Object.keys(require.cache)) if (k.includes("/vercel/")) delete require.cache[k];
  const gauth = require("../lib/gauth");
  const h = require("./harness.js").create(); await new Promise((r) => h.listen(0, r));
  const base = "http://localhost:" + h.address().port;
  const call = async (m, u, hdr = {}) => {
    const r = await fetch(base + u, { method: m, redirect: "manual", headers: hdr });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { s: r.status, j, text, r };
  };
  const me = await call("GET", "/api/auth/me");
  assert.equal(me.s, 200); assert.equal(me.j.enabled, true); assert.equal(me.j.user, null);
  assert.equal((await call("GET", "/api/data")).s, 401);
  const login = await call("GET", "/api/auth/login?next=/magpy/");
  assert.equal(login.s, 302);
  const loc = login.r.headers.get("location");
  assert.match(loc, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const q = new URL(loc).searchParams;
  assert.equal(q.get("client_id"), process.env.GOOGLE_CLIENT_ID);
  assert.equal(q.get("redirect_uri"), base + "/api/auth/callback");
  assert.equal(q.get("scope"), "openid email profile");
  const rawState = login.r.headers.getSetCookie().find((c) => c.startsWith("solavant_oauth="));
  const stateTok = decodeURIComponent(rawState.split(";")[0].slice("solavant_oauth=".length));
  const st = gauth.readToken(stateTok, process.env.SESSION_SECRET);
  assert.equal(st.next, "/magpy/");
  const idFor = (email) => "x." + b64urlJson({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: true }) + ".y";
  const orig = globalThis.fetch;
  globalThis.fetch = (url, opts) => String(url).startsWith("https://oauth2.googleapis.com/")
    ? Promise.resolve(new Response(JSON.stringify({ id_token: idFor("ariel@solavant.com") }), { status: 200, headers: { "content-type": "application/json" } }))
    : orig(url, opts);
  try {
    const cb = await call("GET", "/api/auth/callback?code=abc&state=" + encodeURIComponent(st.n), { cookie: "solavant_oauth=" + encodeURIComponent(stateTok) });
    assert.equal(cb.s, 302); assert.equal(cb.r.headers.get("location"), "/magpy/");
    const sess = cb.r.headers.getSetCookie().find((c) => c.startsWith("solavant_session="));
    assert.match(sess, /HttpOnly/);
    const sessVal = sess.split(";")[0];
    assert.equal((await call("GET", "/api/data", { cookie: sessVal })).s, 200);
    assert.equal((await call("GET", "/api/session", { cookie: sessVal })).j.user.email, "ariel@solavant.com");
    const out = await call("GET", "/api/auth/logout", { cookie: sessVal });
    assert.equal(out.s, 302); assert.match(out.r.headers.get("location"), /signedout=1/);
  } finally { globalThis.fetch = orig; }
  globalThis.fetch = (url, opts) => String(url).startsWith("https://oauth2.googleapis.com/")
    ? Promise.resolve(new Response(JSON.stringify({ id_token: idFor("stranger@example.com") }), { status: 200 }))
    : orig(url, opts);
  try {
    const bad = await call("GET", "/api/auth/callback?code=abc&state=" + encodeURIComponent(st.n), { cookie: "solavant_oauth=" + encodeURIComponent(stateTok) });
    assert.equal(bad.s, 302); assert.match(bad.r.headers.get("location"), /error=notallowed/);
  } finally { globalThis.fetch = orig; }
  process.env.SYNC_KEY = "sync-key-0123456789abcdef0123456789";
  assert.equal((await call("GET", "/api/data", { authorization: "Bearer " + process.env.SYNC_KEY })).s, 200);
  const { pathToFileURL } = require("url");
  const mw = await import(pathToFileURL(path.join(__dirname, "..", "..", "middleware.js")).href);
  const anon = await mw.default({ url: "https://dash.example/", headers: { get: () => null } });
  assert.equal(anon.status, 302); assert.match(anon.headers.get("location"), /\/login\.html\?next=%2F$/);
  const apiAnon = await mw.default({ url: "https://dash.example/api/data", headers: { get: (n) => n === "authorization" ? null : null } });
  assert.equal(apiAnon.status, 401);
  const tok = gauth.makeToken({ e: "ariel@solavant.com", exp: Math.floor(Date.now() / 1000) + 60 }, process.env.SESSION_SECRET);
  const okMw = await mw.default({ url: "https://dash.example/magpy/", headers: { get: (n) => n === "cookie" ? "solavant_session=" + encodeURIComponent(tok) : null } });
  assert.equal(okMw, undefined);
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(await mw.default({ url: "https://dash.example/", headers: { get: () => null } }), undefined);
  delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.SESSION_SECRET; delete process.env.ALLOWED_EMAILS; delete process.env.SYNC_KEY;
  h.close();
  console.log("PASS google sign-in");
}
(async () => {
  await suite("file store", async () => { process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magpy-")); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; delete process.env.KV_REST_API_TOKEN; });
  const fu = require("./fake-upstash").create(); await new Promise((r) => fu.srv.listen(0, r));
  await suite("upstash (fake REST, KV_REST_API_* names)", async () => { process.env.KV_REST_API_URL = "http://localhost:" + fu.srv.address().port; process.env.KV_REST_API_TOKEN = "tok"; });
  assert(fu.kv.get("magpy:state")); console.log("upstash calls:", fu.calls()); fu.srv.close();
  await suite("vercel memory (no redis)", async () => { process.env.VERCEL = "1"; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; delete process.env.KV_REST_API_TOKEN; delete process.env.MAGPY_ALLOW_FILE; });
  await notionSuite();
  portalFiles();
  await googleSuite();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
