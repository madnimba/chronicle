/* Vercel function for the admin panel. vercel.json routes /api/<route> here.

   Environment variables (Vercel → Project → Settings → Environment Variables):
     ADMIN_PASSWORD   password for the admin panel                      (required)
     GITHUB_TOKEN     fine-grained token with "Contents: Read and write"
                      access to this site's repository                  (required)
     GITHUB_REPO      "username/repository"   (optional: detected from the Vercel Git connection)
     GITHUB_BRANCH    default "main"          (optional: detected from the Vercel Git connection)
     SESSION_SECRET   any long random text    (optional: changing it signs everyone out) */
"use strict";
const { createApi } = require("./_lib");
const { githubStorage } = require("./_github");

const env = process.env;
const repo = env.GITHUB_REPO ||
  (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : "");
const branch = env.GITHUB_BRANCH || env.VERCEL_GIT_COMMIT_REF || "main";

const missing = [
  !env.ADMIN_PASSWORD && "ADMIN_PASSWORD",
  !env.GITHUB_TOKEN && "GITHUB_TOKEN",
  !repo && "GITHUB_REPO"
].filter(Boolean);

const handle = createApi({
  storage: githubStorage({ token: env.GITHUB_TOKEN, repo, branch }),
  password: env.ADMIN_PASSWORD,
  secret: env.SESSION_SECRET,
  configError: missing.length
    ? `The admin panel is not set up yet. Add ${missing.join(", ")} in Vercel → Settings → Environment Variables, then redeploy.`
    : ""
});

module.exports = (req, res) => {
  const route = (req.query && req.query.route) || String(req.url || "").split("?")[0].replace(/^\/api\//, "");
  return handle(req, res, route);
};
