// Single Vercel Function handling every /api/* route (same endpoints as server.js).
module.exports = require("../lib/app").handler;
