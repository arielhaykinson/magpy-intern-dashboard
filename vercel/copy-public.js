const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "public");
const portal = path.join(__dirname, "..", "portal");
const dest = path.join(__dirname, "..", "public");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
// The Solavant portal owns /, login, the logo, and the /magpy/ shell.
// Dashboard JS and CSS stay at the site root because that shell loads them from /.
fs.cpSync(portal, dest, { recursive: true });
