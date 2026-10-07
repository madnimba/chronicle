/* ==========================================================================
   Admin API shared by the local server (server.js) and Vercel (api/admin.js).
   Storage is pluggable: local files, or the GitHub repository on Vercel.

   storage = {
     kind,                        "local" | "github"
     maxUpload,                   largest upload in bytes
     read()        -> content object
     write(obj)                   save content
     listBackups() -> [{ id, time, label }]   newest first, previous versions only
     restore(id)   -> content object (also saved)
     upload(name, buffer) -> "uploads/file.ext"
   }
   ========================================================================== */
"use strict";
const crypto = require("crypto");
const path = require("path");

const SESSION_MINUTES = 30;   // sign-in lasts this long, then the admin must sign in again
const UPLOAD_TYPES = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

/* ---------------- Content file format ---------------- */
function serialize(obj) {
  return "/* Site content. Edit through the admin panel (/admin/), not by hand. */\n" +
    "window.SITE_CONTENT = " + JSON.stringify(obj, null, 2) + ";\n";
}
function parse(src) {
  return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
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
function uploadName(name) {
  const rawExt = path.extname(String(name || "")), ext = rawExt.toLowerCase();
  if (!UPLOAD_TYPES.includes(ext)) return "";
  const base = path.basename(String(name), rawExt).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  return `${base}-${Date.now().toString(36)}${ext}`;
}

/* ---------------- Sessions: signed cookie, no server memory needed ---------------- */
function makeAuth(password, secret) {
  const key = secret || crypto.createHash("sha256").update("portfolio-session:" + password).digest("hex");
  const sign = v => crypto.createHmac("sha256", key).update(v).digest("hex");
  return {
    passwordMatches(input) {
      if (!password) return false;
      const a = crypto.createHash("sha256").update(String(input)).digest();
      const b = crypto.createHash("sha256").update(password).digest();
      return crypto.timingSafeEqual(a, b);
    },
    token() { const exp = String(Date.now() + SESSION_MINUTES * 60e3); return `${exp}.${sign(exp)}`; },
    expires(t) { return Number(String(t || "").split(".")[0]) || 0; },
    valid(t) {
      const [exp, sig] = String(t || "").split(".");
      if (!exp || !sig || Number(exp) < Date.now()) return false;
      const good = sign(exp);
      return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
    }
  };
}

/* ---------------- HTTP helpers ---------------- */
function getCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "";
}
function json(res, code, obj, headers = {}) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...headers
  });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  // Vercel parses JSON bodies itself; the local server does not.
  if (req.body !== undefined) {
    if (typeof req.body === "object" && req.body !== null && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || "{}")); }
    catch { return Promise.reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("That file is too large."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

/* ---------------- The API ---------------- */
function createApi({ storage, password, secret, configError }) {
  const auth = makeAuth(password, secret);
  const failures = new Map();   // best effort; resets when a serverless instance restarts

  return async function handle(req, res, route) {
    try {
      const method = req.method;
      const secure = req.headers["x-forwarded-proto"] === "https" || !!(req.socket && req.socket.encrypted);
      // Mutating calls must come from the admin page's script (blocks cross-site form posts).
      if (method !== "GET" && req.headers["x-admin"] !== "1") return json(res, 403, { error: "Forbidden" });

      if (route === "status" && method === "GET")
        return json(res, 200, {
          server: true, host: storage.kind, maxUpload: storage.maxUpload,
          authed: !configError && auth.valid(getCookie(req, "adm")),
          expires: auth.valid(getCookie(req, "adm")) ? auth.expires(getCookie(req, "adm")) : 0, now: Date.now(),
          configError: configError || ""
        });

      if (configError) return json(res, 503, { error: configError });

      if (route === "login" && method === "POST") {
        const ip = clientIp(req), f = failures.get(ip);
        if (f && f.count >= 8 && f.until > Date.now())
          return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
        const { password: input } = await readBody(req, 10e3);
        if (!auth.passwordMatches(input || "")) {
          const cur = f && f.until > Date.now() ? f : { count: 0 };
          failures.set(ip, { count: cur.count + 1, until: Date.now() + 15 * 60e3 });
          await new Promise(r => setTimeout(r, 700));
          return json(res, 401, { error: "Incorrect password." });
        }
        failures.delete(ip);
        const token = auth.token();
        const cookie = `adm=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MINUTES * 60}${secure ? "; Secure" : ""}`;
        return json(res, 200, { ok: true, expires: auth.expires(token), now: Date.now() }, { "Set-Cookie": cookie });
      }

      if (route === "logout" && method === "POST")
        return json(res, 200, { ok: true }, { "Set-Cookie": "adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });

      if (!auth.valid(getCookie(req, "adm"))) return json(res, 401, { error: "Please sign in again." });

      if (route === "content" && method === "GET") return json(res, 200, await storage.read());

      if (route === "content" && method === "PUT") {
        const body = await readBody(req, 4e6);
        const err = validate(body);
        if (err) return json(res, 400, { error: err });
        await storage.write(body, "Update site content (admin panel)");
        return json(res, 200, { ok: true });
      }

      if (route === "backups" && method === "GET") return json(res, 200, await storage.listBackups());

      if (route === "restore" && method === "POST") {
        const { id } = await readBody(req, 10e3);
        const obj = await storage.restore(String(id || ""));
        if (!obj) return json(res, 404, { error: "Backup not found." });
        return json(res, 200, obj);
      }

      if (route === "upload" && method === "POST") {
        const { name, data } = await readBody(req, storage.maxUpload * 1.4 + 10e3);
        const file = uploadName(name);
        if (!file) return json(res, 400, { error: "Only PDF and image files can be uploaded." });
        const buf = Buffer.from(String(data || ""), "base64");
        if (buf.length > storage.maxUpload) return json(res, 413, { error: "That file is too large." });
        return json(res, 200, { path: await storage.upload(file, buf) });
      }

      return json(res, 404, { error: "Not found" });
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : (e.publicMessage || "Server error") });
    }
  };
}

module.exports = { createApi, serialize, parse, validate };
