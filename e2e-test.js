// Two headless clients + server restart. Run: node e2e-test.js (needs puppeteer-core, google-chrome, server on :8765)
const puppeteer = require(process.env.PPTR || "/tmp/pt2/node_modules/puppeteer-core"), { execSync } = require("child_process");
const URL_ = process.env.URL || "http://localhost:8765/index.html#tasks", sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "new" });
  const mk = async (name) => { const c = await b.createBrowserContext(); const p = await c.newPage(); await p.evaluateOnNewDocument((n) => localStorage.setItem("magpy-user", n), name); await p.goto(URL_); await p.waitForSelector("#list .row"); return p; };
  const A = await mk("Ariel"), C = await mk("Can"), res = [], ok = (n, c) => { res.push((c ? "PASS " : "FAIL ") + n); };
  const has = (p, t) => p.evaluate((t) => document.body.innerText.includes(t), t);
  const waitFor = async (p, t, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await has(p, t)) return Date.now() - s; await sleep(50); } return -1; };
  ok("indicator Saved", (await A.$eval("#syncState", (e) => e.textContent)).includes("Saved"));
  // A adds task -> appears in C
  await A.type("#qTitle", "E2E from Ariel"); await A.click("#quick button");
  const dt = await waitFor(C, "E2E from Ariel"); ok("add syncs to other client (" + dt + "ms)", dt >= 0 && dt < 1500);
  // C opens modal, A edits other task; C modal stays open
  await C.evaluate(() => [...document.querySelectorAll("#list .row .title")].find((e) => e.textContent === "E2E from Ariel").click());
  await C.type("#form [name=notes]", "typing in progress");
  await A.evaluate(() => [...document.querySelectorAll("#list .row .title")].find((e) => e.textContent === "Natrion sonar").click());
  await A.$eval("#form [name=title]", (e) => (e.value = "Natrion sonar v2")); await A.click("#form .primary");
  const dt2 = await waitFor(C, "Natrion sonar v2"); ok("edit syncs (" + dt2 + "ms)", dt2 >= 0 && dt2 < 1500);
  ok("open modal survived remote re-render", await C.evaluate(() => document.querySelector("#modal").open && document.querySelector("[name=notes]").value === "typing in progress"));
  await C.click("#cancel");
  // hours
  await A.evaluate(() => { location.hash = "#hours"; }); await A.waitForSelector("#hours input");
  await A.$eval("#hours input[data-p=Can]", (e) => { e.value = "6.5"; e.dispatchEvent(new Event("change", { bubbles: true })); });
  await C.evaluate(() => { location.hash = "#hours"; }); await sleep(1200);
  ok("hours sync", await C.$eval("#hours input[data-p=Can]", (e) => e.value === "6.5"));
  // delete
  await A.evaluate(() => { window.confirm = () => true; }); await A.evaluate(() => { location.hash = "#tasks"; }); await sleep(200);
  await A.evaluate(() => [...document.querySelectorAll("#list .row .title")].find((e) => e.textContent === "E2E from Ariel").click());
  await A.click("#del"); await sleep(1200); ok("delete syncs", !(await has(C, "E2E from Ariel")));
  // persistence across restart
  await A.evaluate(() => { location.hash = "#tasks"; }); await sleep(300);
  await A.type("#qTitle", "E2E survives restart"); await A.click("#quick button"); await sleep(500);
  execSync(__dirname + "/run.sh"); await sleep(1500);
  const dt3 = await waitFor(C, "Natrion sonar v2", 1); ok("after restart data persisted (reload)", await (async () => { await C.goto(URL_); await C.reload(); await C.waitForSelector("#list .row"); return (await has(C, "E2E survives restart")) && (await has(C, "Natrion sonar v2")); })());
  // reconnect: C edits after restart, A gets it
  await C.evaluate(() => { location.hash = "#tasks"; }); await sleep(300);
  await C.type("#qTitle", "E2E post-restart"); await C.click("#quick button");
  const dt4 = await waitFor(A, "E2E post-restart", 5000); ok("SSE reconnects after restart (" + dt4 + "ms)", dt4 >= 0);
  // demo mode doesn't touch server
  const before = await (await fetch("http://localhost:8765/api/data")).text();
  const D = await b.newPage(); await D.goto("http://localhost:8765/index.html#demo"); await D.waitForSelector("#list .row");
  await D.type("#qTitle", "demo only"); await D.click("#quick button"); await sleep(500);
  ok("demo works locally", await has(D, "demo only")); ok("demo leaves server untouched", before === (await (await fetch("http://localhost:8765/api/data")).text()));
  console.log(res.join("\n")); await b.close();
})();
