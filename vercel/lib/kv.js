// Storage adapter: one JSON document { rev, db } with compare-and-set on rev.
//   read()            -> { rev, db } | { rev: 0, db: null } when empty
//   cas(rev, db)      -> true if written (stored rev becomes rev+1), false on conflict
const fs = require("fs"), path = require("path");

const KEY = process.env.MAGPY_KEY || "magpy:state", REVKEY = KEY + ":rev";
const LUA = "local c=tonumber(redis.call('GET',KEYS[2]) or '0'); if c ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); redis.call('SET',KEYS[2],tostring(c+1)); return 1";

function upstash(url, token) {
  url = url.replace(/\/+$/, "");
  const cmd = async (args) => {
    const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error("Upstash: " + (j.error || "HTTP " + r.status));
    return j.result;
  };
  return {
    name: "upstash",
    async read() { const [doc, rev] = await cmd(["MGET", KEY, REVKEY]); return { rev: +rev || 0, db: doc ? JSON.parse(doc) : null }; },
    async cas(rev, db) { return (await cmd(["EVAL", LUA, "2", KEY, REVKEY, String(rev), JSON.stringify(db)])) === 1; },
  };
}

function file(dir) {
  const f = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });
  const load = () => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return { rev: 0, db: null }; } };
  return {
    name: "file",
    async read() { return load(); },
    // Synchronous compare+write: atomic within one process (local testing only).
    async cas(rev, db) {
      const cur = load(); if (cur.rev !== rev) return false;
      const tmp = f + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, JSON.stringify({ rev: rev + 1, db })); fs.renameSync(tmp, f); return true;
    },
  };
}

// Per-instance only. Tasks are re-read from Notion, so a cold start still shows the board.
// Hours, meetings, comments, and asks need Upstash or they disappear with the instance.
function memory() {
  let rev = 0, raw = null;
  return {
    name: "memory",
    async read() { return { rev, db: raw ? JSON.parse(raw) : null }; },
    async cas(expected, db) {
      if (rev !== expected) return false;
      rev += 1; raw = JSON.stringify(db); return true;
    },
  };
}

let inst;
function getStore() {
  if (inst) return inst;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) inst = upstash(url, token);
  else if (process.env.VERCEL && !process.env.MAGPY_ALLOW_FILE) inst = memory();
  else inst = file(process.env.DATA_DIR || path.join(__dirname, "..", ".data"));
  return inst;
}
module.exports = { getStore, upstash, file };
