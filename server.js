#!/usr/bin/env node
/* ==========================================================================
   Local server: serves the website and lets the admin panel save to the
   files in this folder. No dependencies. Run with:   node server.js
   Then open http://localhost:8080  (admin panel: http://localhost:8080/admin/)

   Settings (environment variables, or lines in a ".env" file next to this file):
     ADMIN_PASSWORD   password for the admin panel (generated on first run)
     PORT             default 8080
     HOST             default 127.0.0.1 locally, 0.0.0.0 when PORT is set by a host

   On Vercel this file is not used; api/admin.js saves to GitHub instead.
   ========================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createApi, serialize, parse } = require("./api/_lib");

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, "data", "content.js");
const BACKUP_DIR = path.join(ROOT, "backups");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const ENV_FILE = path.join(ROOT, ".env");
const MAX_BACKUPS = 50;

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

/* ---------------- Local file storage ---------------- */
const BACKUP_RE = /^content-[\dTZ-]+\.js$/;
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort().reverse()
    .map(f => ({ id: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString(), label: "" }));
}
function write(obj) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(CONTENT_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(CONTENT_FILE, path.join(BACKUP_DIR, `content-${stamp}.js`));
  }
  const tmp = CONTENT_FILE + ".tmp";
  fs.writeFileSync(tmp, serialize(obj));
  fs.renameSync(tmp, CONTENT_FILE);
  for (const b of listBackups().slice(MAX_BACKUPS)) fs.unlinkSync(path.join(BACKUP_DIR, b.id));
}
const localStorage = {
  kind: "local",
  maxUpload: 15 * 1024 * 1024,
  read: () => parse(fs.readFileSync(CONTENT_FILE, "utf8")),
  write,
  listBackups,
  restore(id) {
    const file = path.join(BACKUP_DIR, id);
    if (!BACKUP_RE.test(id) || !fs.existsSync(file)) return null;
    const obj = parse(fs.readFileSync(file, "utf8"));
    write(obj);
    return obj;
  },
  upload(file, buf) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    return `uploads/${file}`;
  }
};
const api = createApi({ storage: localStorage, password: ADMIN_PASSWORD });

/* ---------------- Static files ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"
};
const BLOCKED = /^\/(\.|backups\/|api\/|server\.js$|vercel\.json$|package(-lock)?\.json$|node_modules\/|README)|\/\./i;

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}
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
http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath.startsWith("/api/")) return api(req, res, urlPath.slice(5));
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  serveStatic(req, res, urlPath);
}).listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`  Website:      http://${shown}:${PORT}/`);
  console.log(`  Admin panel:  http://${shown}:${PORT}/admin/`);
});
