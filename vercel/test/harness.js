const http = require("http"), fs = require("fs"), path = require("path");
const PUB = path.join(__dirname, "..", "public"), PORTAL = path.join(__dirname, "..", "..", "portal"), api = require("../api/[...path].js");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg" };
function staticFile(p) {
  if (p === "/" || p === "/index.html") return path.join(PORTAL, "index.html");
  if (p === "/login.html") return path.join(PORTAL, "login.html");
  if (p === "/solavant-logo.jpg") return path.join(PORTAL, "solavant-logo.jpg");
  if (p === "/magpy" || p === "/magpy/" || p === "/magpy/index.html") return path.join(PORTAL, "magpy", "index.html");
  const f = path.normalize(path.join(PUB, p));
  return f.startsWith(PUB) ? f : "";
}
function create() {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/")) return api(req, res);
    const f = staticFile(p);
    if (!f) { res.writeHead(404); return res.end(); }
    fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end("not found"); } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(b); });
  });
}
module.exports = { create };
if (require.main === module) { const port = +process.env.PORT || 3000; create().listen(port, () => console.log("harness on http://localhost:" + port)); }
