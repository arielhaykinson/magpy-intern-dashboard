const fs = require("fs"), path = require("path");
const src = path.join(__dirname, ".."), dst = path.join(__dirname, "public");
fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(path.join(dst, "fonts"), { recursive: true });
for (const f of ["index.html", "app.js", "store.js", "style.css", "logo.png", "favicon.png", "favicon-32.png", "apple-touch-icon.png"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
for (const f of fs.readdirSync(path.join(src, "fonts"))) fs.copyFileSync(path.join(src, "fonts", f), path.join(dst, "fonts", f));
console.log("public/ synced");
