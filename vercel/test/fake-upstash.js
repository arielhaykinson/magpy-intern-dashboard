// Minimal fake of Upstash REST (MGET / GET / SET / EVAL of our CAS script) for adapter testing.
const http = require("http");
function create() {
  const kv = new Map(); let calls = 0;
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      calls++;
      if (req.headers.authorization !== "Bearer tok") { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }
      const [cmd, ...a] = JSON.parse(b); let result;
      if (cmd === "MGET") result = a.map((k) => kv.get(k) ?? null);
      else if (cmd === "EVAL") { const [, , k1, k2, rev, doc] = a; const c = +(kv.get(k2) || 0); if (c !== +rev) result = 0; else { kv.set(k1, doc); kv.set(k2, String(c + 1)); result = 1; } }
      else { res.writeHead(200); return res.end(JSON.stringify({ error: "ERR unknown " + cmd })); }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ result }));
    });
  });
  return { srv, kv, calls: () => calls };
}
module.exports = { create };
