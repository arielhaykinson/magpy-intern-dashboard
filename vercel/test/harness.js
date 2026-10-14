const http = require("http"), fs = require("fs"), path = require("path");
const PUB = path.join(__dirname, "..", "public"), api = require("../api/[...path].js");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
function create() {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/")) return api(req, res);
    const f = path.normalize(path.join(PUB, p === "/" ? "index.html" : p));
    if (!f.startsWith(PUB)) { res.writeHead(404); return res.end(); }
    fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end("not found"); } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(b); });
  });
}
module.exports = { create };
if (require.main === module) { const port = +process.env.PORT || 3000; create().listen(port, () => console.log("harness on http://localhost:" + port)); }
