const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "public");
const dest = path.join(__dirname, "..", "public");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
