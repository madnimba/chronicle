#!/usr/bin/env node
/* ==========================================================================
   Portfolio server: serves the website and the admin panel's save API.
   No dependencies. Run with:   node server.js
   Then open http://localhost:8080  (admin panel: http://localhost:8080/admin/)

   Settings (environment variables, or lines in a ".env" file next to this file):
     ADMIN_PASSWORD   password for the admin panel (generated on first run)
     PORT             default 8080
     HOST             default 127.0.0.1 locally, 0.0.0.0 when PORT is set by a host
   ========================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, "data", "content.js");
const BACKUP_DIR = path.join(ROOT, "backups");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const ENV_FILE = path.join(ROOT, ".env");
const MAX_BACKUPS = 50;
const SESSION_HOURS = 12;

/* ---------------- Config ---------------- */
function readEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = readEnvFile();
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || fileEnv.ADMIN_PASSWORD || "";
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString("base64url");
  fs.appendFileSync(ENV_FILE, `ADMIN_PASSWORD=${ADMIN_PASSWORD}\n`);
  console.log(`\n  No admin password was set, so one was generated and saved to .env:\n\n      ${ADMIN_PASSWORD}\n\n  Change it by editing .env and restarting the server.\n`);
}
const PORT = Number(process.env.PORT || fileEnv.PORT || 8080);
const HOST = process.env.HOST || fileEnv.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

/* ---------------- Sessions & login throttling ---------------- */
const sessions = new Map();           // token -> expiry (ms)
const failures = new Map();           // ip -> { count, until }

function newSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
  return token;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
}
function isAuthed(req) {
  const t = getCookie(req, "adm");
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function passwordMatches(input) {
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}
function isHttps(req) {
  return req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
}

/* ---------------- Content file ---------------- */
function readContent() {
  const src = fs.readFileSync(CONTENT_FILE, "utf8");
  const start = src.indexOf("{"), end = src.lastIndexOf("}");
  return JSON.parse(src.slice(start, end + 1));
}
function serializeContent(obj) {
  return "/* Site content. Edit through the admin panel (/admin/), not by hand. */\n" +
    "window.SITE_CONTENT = " + JSON.stringify(obj, null, 2) + ";\n";
}
function validate(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "Content must be an object.";
  for (const k of ["site", "profile", "home", "research"])
    if (!c[k] || typeof c[k] !== "object") return `Missing section "${k}".`;
  if (!Array.isArray(c.papers)) return "Papers must be a list.";
  const ids = new Set(), slugs = new Set();
  for (const [i, p] of c.papers.entries()) {
    const n = `Paper ${i + 1}`;
    if (!p || typeof p !== "object") return `${n} is invalid.`;
    if (!/^[A-Za-z0-9-]{1,20}$/.test(p.id || "")) return `${n}: the ID may use only letters, digits and hyphens.`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || "")) return `${n}: the link name may use only lowercase letters, digits and hyphens.`;
    if (ids.has(p.id)) return `${n}: ID "${p.id}" is used twice.`;
    if (slugs.has(p.slug)) return `${n}: link name "${p.slug}" is used twice.`;
    ids.add(p.id); slugs.add(p.slug);
    if (!String(p.title || "").trim()) return `${n} has no title.`;
    if (!Array.isArray(p.authors)) return `${n}: authors must be a list.`;
  }
  return "";
}
function backupStamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function writeContent(obj) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(CONTENT_FILE))
    fs.copyFileSync(CONTENT_FILE, path.join(BACKUP_DIR, `content-${backupStamp()}.js`));
  const tmp = CONTENT_FILE + ".tmp";
  fs.writeFileSync(tmp, serializeContent(obj));
  fs.renameSync(tmp, CONTENT_FILE);
  const old = listBackups().slice(MAX_BACKUPS);
  for (const b of old) fs.unlinkSync(path.join(BACKUP_DIR, b.file));
}
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => /^content-[\dTZ-]+\.js$/.test(f)).sort().reverse()
    .map(file => ({ file, time: fs.statSync(path.join(BACKUP_DIR, file)).mtime.toISOString() }));
}

/* ---------------- HTTP helpers ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"
};
const UPLOAD_TYPES = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
const BLOCKED = /^\/(\.|backups\/|server\.js$|package(-lock)?\.json$|node_modules\/|README)|\/\./i;

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}
function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

/* ---------------- API ---------------- */
async function api(req, res, route) {
  const method = req.method;
  // Mutating calls must come from the admin page's script (blocks cross-site form posts).
  if (method !== "GET" && req.headers["x-admin"] !== "1") return json(res, 403, { error: "Forbidden" });

  if (route === "status" && method === "GET")
    return json(res, 200, { server: true, authed: isAuthed(req) });

  if (route === "login" && method === "POST") {
    const ip = clientIp(req), f = failures.get(ip);
    if (f && f.count >= 8 && f.until > Date.now())
      return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const { password } = await readBody(req, 10e3);
    if (!passwordMatches(password || "")) {
      const cur = f && f.until > Date.now() ? f : { count: 0 };
      failures.set(ip, { count: cur.count + 1, until: Date.now() + 15 * 60e3 });
      await new Promise(r => setTimeout(r, 600));
      return json(res, 401, { error: "Incorrect password." });
    }
    failures.delete(ip);
    const token = newSession();
    const cookie = `adm=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${isHttps(req) ? "; Secure" : ""}`;
    return json(res, 200, { ok: true }, { "Set-Cookie": cookie });
  }

  if (route === "logout" && method === "POST") {
    sessions.delete(getCookie(req, "adm"));
    return json(res, 200, { ok: true }, { "Set-Cookie": "adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (!isAuthed(req)) return json(res, 401, { error: "Please sign in again." });

  if (route === "content" && method === "GET") return json(res, 200, readContent());

  if (route === "content" && method === "PUT") {
    const body = await readBody(req, 5e6);
    const err = validate(body);
    if (err) return json(res, 400, { error: err });
    writeContent(body);
    return json(res, 200, { ok: true });
  }

  if (route === "backups" && method === "GET") return json(res, 200, listBackups());

  if (route === "restore" && method === "POST") {
    const { file } = await readBody(req, 10e3);
    if (!/^content-[\dTZ-]+\.js$/.test(file || "") || !fs.existsSync(path.join(BACKUP_DIR, file)))
      return json(res, 404, { error: "Backup not found." });
    const src = fs.readFileSync(path.join(BACKUP_DIR, file), "utf8");
    const obj = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
    writeContent(obj);
    return json(res, 200, obj);
  }

  if (route === "upload" && method === "POST") {
    const { name, data } = await readBody(req, 22e6);
    const ext = path.extname(String(name || "")).toLowerCase();
    if (!UPLOAD_TYPES.includes(ext)) return json(res, 400, { error: "Only PDF and image files can be uploaded." });
    const base = path.basename(String(name), ext).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
    const file = `${base}-${Date.now().toString(36)}${ext}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(String(data || ""), "base64"));
    return json(res, 200, { path: `uploads/${file}` });
  }

  return json(res, 404, { error: "Not found" });
}

/* ---------------- Static files ---------------- */
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return send(res, 400, "Bad request"); }
  if (BLOCKED.test(rel)) return send(res, 404, "Not found");
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 404, "Not found");
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!urlPath.endsWith("/")) return send(res, 301, "", { Location: urlPath + "/" });
      file = path.join(file, "index.html");
    }
    fs.readFile(file, (e, buf) => {
      if (e) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      const ext = path.extname(file).toLowerCase();
      const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
      if (file === CONTENT_FILE || ext === ".html") headers["Cache-Control"] = "no-cache";
      if (rel.startsWith("/admin")) { headers["X-Frame-Options"] = "DENY"; headers["Cache-Control"] = "no-store"; }
      send(res, 200, req.method === "HEAD" ? "" : buf, headers);
    });
  });
}

/* ---------------- Server ---------------- */
http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  try {
    if (urlPath.startsWith("/api/")) return await api(req, res, urlPath.slice(5));
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    serveStatic(req, res, urlPath);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : "Server error" });
    if (!e.status) console.error(e);
  }
}).listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`  Website:      http://${shown}:${PORT}/`);
  console.log(`  Admin panel:  http://${shown}:${PORT}/admin/`);
});
