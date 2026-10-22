// Vercel Routing Middleware: gates every page and /api/* behind Google sign-in when GOOGLE_CLIENT_ID is set.
// With GOOGLE_CLIENT_ID unset it does nothing (site stays open). Session format is shared with lib/gauth.js.
export const config = { matcher: ["/((?!api/auth/|login\\.html|solavant-logo\\.jpg|fonts/|favicon|apple-touch-icon).*)"] };

const COOKIE = "solavant_session";
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

async function verify(tok, key) {
  if (!tok || !key) return null; const [p, s] = tok.split("."); if (!p || !s) return null;
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64url(await crypto.subtle.sign("HMAC", k, enc.encode(p)));
  if (want.length !== s.length) return null; let d = 0; for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ want.charCodeAt(i); if (d) return null;
  try { const o = JSON.parse(fromB64url(p)); return o.exp > Date.now() / 1000 ? o : null; } catch { return null; }
}
const allowed = (email, raw) => { email = String(email || "").toLowerCase(); if (!email.includes("@")) return false; const l = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); if (!l.length || l.includes("*")) return true; return l.some((a) => (a.startsWith("@") ? email.endsWith(a) : a === email)); };

async function syncKeyOk(h, key) {
  if (!h || key.length < 32) return false; const mm = /^Bearer\s+(.+)$/i.exec(h); if (!mm) return false;
  const d = async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)));
  const a = await d(mm[1].trim()), b = await d(key); let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0;
}
export default async function middleware(request) {
  const env = (typeof process !== "undefined" && process.env) || {};
  if (!env.GOOGLE_CLIENT_ID) return; // auth disabled
  const url = new URL(request.url);
  const m = /(?:^|;\s*)solavant_session=([^;]+)/.exec(request.headers.get("cookie") || "");
  const s = m ? await verify(decodeURIComponent(m[1]), env.SESSION_SECRET || "") : null;
  if (s && allowed(s.e, env.ALLOWED_EMAILS || "")) return; // continue to the page / function
  if (url.pathname.startsWith("/api/") && await syncKeyOk(request.headers.get("authorization"), env.SYNC_KEY || "")) return; // box-side sync routine
  if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const login = new URL("/login.html", url); login.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(login.toString(), 302);
}
