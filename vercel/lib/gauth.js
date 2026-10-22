// Google Sign-In (OAuth 2.0 Authorization Code flow) + signed session cookie + email allowlist.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, ALLOWED_EMAILS (comma/space separated;
// "@domain.com" entries allow a whole domain). Optional PUBLIC_URL (e.g. https://example.vercel.app) pins the redirect URI.
// Token format (shared with ../middleware.js): base64url(JSON{e,exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET, part1)).
const crypto = require("crypto");

const COOKIE = "solavant_session", STATE_COOKIE = "solavant_oauth", SESSION_S = 7 * 24 * 3600, STATE_S = 600;
const env = () => ({
  id: process.env.GOOGLE_CLIENT_ID || "", secret: process.env.GOOGLE_CLIENT_SECRET || "",
  key: process.env.SESSION_SECRET || "", allow: parseAllow(process.env.ALLOWED_EMAILS || ""), publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
});
const enabled = () => !!process.env.GOOGLE_CLIENT_ID;
function parseAllow(s) { return s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); }
function allowed(email, list = env().allow) {
  email = String(email || "").toLowerCase(); if (!email.includes("@")) return false;
  if (!list.length || list.includes("*")) return true; // "*" or unset: any verified Google account
  return list.some((a) => (a.startsWith("@") ? email.endsWith(a) : a === email));
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data, key) => crypto.createHmac("sha256", key).update(data).digest("base64url");
function makeToken(obj, key) { const p = b64(JSON.stringify(obj)); return p + "." + sign(p, key); }
function readToken(tok, key) {
  if (!tok || !key) return null; const [p, s] = String(tok).split("."); if (!p || !s) return null;
  const want = sign(p, key); if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); return o.exp > Date.now() / 1000 ? o : null; } catch { return null; }
}
const getCookie = (req, name) => { const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(req.headers.cookie || ""); return m ? decodeURIComponent(m[1]) : ""; };
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const setCookie = (req, name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
function origin(req) {
  const e = env(); if (e.publicUrl) return e.publicUrl;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return (isHttps(req) ? "https://" : "http://") + host;
}
const redirectUri = (req) => origin(req) + "/api/auth/callback";
const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[^\\]*$/.test(n) ? n : "/");

// Server-side sync key: "Authorization: Bearer <SYNC_KEY>" grants API access (for box-side sync routines).
function syncKeyOk(req) {
  const k = process.env.SYNC_KEY || ""; if (k.length < 32) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || "")); if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1].trim()).digest(), b = crypto.createHash("sha256").update(k).digest();
  return crypto.timingSafeEqual(a, b);
}
// Current signed-in, still-allowlisted user (or null).
function sessionUser(req) {
  const e = env(); const s = readToken(getCookie(req, COOKIE), e.key);
  return s && allowed(s.e, e.allow) ? { email: s.e } : null;
}

function redirect(res, to, cookies = []) { res.statusCode = 302; if (cookies.length) res.setHeader("set-cookie", cookies); res.setHeader("location", to); res.setHeader("cache-control", "no-store"); res.end(); }
const json = (res, code, o) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(o)); };
const fail = (req, res, code) => redirect(res, "/login.html?error=" + code, [setCookie(req, STATE_COOKIE, "", 0)]);

// Handles /api/auth/*. Returns true when it handled the request.
async function handleAuth(req, res, p, url, fetchImpl = globalThis.fetch) {
  if (!p.startsWith("/api/auth/")) return false;
  const e = env();
  if (p === "/api/auth/me") { const u = enabled() ? sessionUser(req) : null; json(res, 200, { enabled: enabled(), user: u }); return true; }
  if (p === "/api/auth/logout") { redirect(res, "/login.html?signedout=1", [setCookie(req, COOKIE, "", 0)]); return true; }
  if (!enabled() || !e.secret || !e.key) { json(res, 503, { error: "Google sign-in is not configured" }); return true; }

  if (p === "/api/auth/login") {
    const nonce = crypto.randomBytes(16).toString("base64url");
    const state = makeToken({ n: nonce, next: safeNext(url.searchParams.get("next")), exp: Math.floor(Date.now() / 1000) + STATE_S }, e.key);
    const q = new URLSearchParams({ client_id: e.id, redirect_uri: redirectUri(req), response_type: "code", scope: "openid email profile", state: nonce, prompt: "select_account" });
    redirect(res, "https://accounts.google.com/o/oauth2/v2/auth?" + q, [setCookie(req, STATE_COOKIE, state, STATE_S)]);
    return true;
  }
  if (p === "/api/auth/callback") {
    const st = readToken(getCookie(req, STATE_COOKIE), e.key);
    if (url.searchParams.get("error")) { fail(req, res, "cancelled"); return true; }
    const code = url.searchParams.get("code"), nonce = url.searchParams.get("state");
    if (!st || !code || !nonce || nonce !== st.n) { fail(req, res, "state"); return true; }
    let tok;
    try {
      const r = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: e.id, client_secret: e.secret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }).toString() });
      tok = await r.json(); if (!r.ok || !tok.id_token) throw new Error(tok.error || "no id_token");
    } catch (err) { console.warn("oauth token exchange failed:", (tok && tok.error) || String(err && err.message || err)); fail(req, res, "exchange"); return true; }
    // id_token came straight from Google over TLS in exchange for our secret, so per OIDC we only validate its claims.
    let c; try { c = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString("utf8")); } catch { fail(req, res, "token"); return true; }
    const issOk = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
    if (!issOk || c.aud !== e.id || !(c.exp > Date.now() / 1000) || !c.email || c.email_verified === false || c.email_verified === "false") { fail(req, res, "token"); return true; }
    if (!allowed(c.email, e.allow)) { fail(req, res, "notallowed"); return true; }
    const sess = makeToken({ e: String(c.email).toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_S }, e.key);
    redirect(res, st.next, [setCookie(req, COOKIE, sess, SESSION_S), setCookie(req, STATE_COOKIE, "", 0)]);
    return true;
  }
  json(res, 404, { error: "not found" }); return true;
}

module.exports = { syncKeyOk, handleAuth, sessionUser, enabled, allowed, parseAllow, makeToken, readToken, COOKIE };
