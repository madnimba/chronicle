/* Storage on Vercel: reads and commits files in the site's GitHub repository.
   Every commit makes Vercel redeploy the site, and the commit history is the backup list. */
"use strict";
const { serialize, parse } = require("./_lib");

const CONTENT_PATH = "data/content.js";

function githubStorage({ token, repo, branch }) {
  token = String(token || "").trim();   // pasted tokens often carry a stray space or newline
  async function gh(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "portfolio-admin",
        ...(opts.body ? { "Content-Type": "application/json" } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const writing = (opts.method || "GET") !== "GET";
      const reason = `GitHub said: "${data.message || "request failed"}" (${res.status}, while ${writing ? "saving to" : "reading"} ${repo})`;
      const e = new Error(reason);
      e.gh = res.status;
      e.publicMessage =
        res.status === 401 ? `GitHub did not accept GITHUB_TOKEN; it may be mistyped, expired or revoked. ${reason}`
        : res.status === 403 && writing ? `GITHUB_TOKEN can read but not write. Give the token "Contents: Read and write" access to ${repo}. ${reason}`
        : res.status === 403 ? `GitHub refused access for GITHUB_TOKEN. ${reason}`
        : res.status === 404 ? `Not found. Check that the token has access to ${repo} and that the branch "${branch}" exists. ${reason}`
        : `Could not save to GitHub. ${reason}`;
      throw e;
    }
    return data;
  }
  const enc = encodeURIComponent;
  const getFile = (path, ref) => gh(`/contents/${path}?ref=${enc(ref || branch)}`);
  const decode = f => Buffer.from(f.content, "base64").toString("utf8");

  async function putFile(path, buf, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let sha;
      try { sha = (await getFile(path)).sha; } catch (e) { if (e.gh !== 404) throw e; }
      try {
        return await gh(`/contents/${path}`, {
          method: "PUT",
          body: { message, content: buf.toString("base64"), branch, ...(sha ? { sha } : {}) }
        });
      } catch (e) {
        if (e.gh !== 409 && e.gh !== 422) throw e;   // someone else changed the file meanwhile: retry
      }
    }
    throw Object.assign(new Error("GitHub conflict"), { publicMessage: "Could not save because the file changed at the same time. Please try again." });
  }

  return {
    kind: "github",
    maxUpload: 3 * 1024 * 1024,   // Vercel limits request bodies to 4.5 MB (base64 adds a third)
    async read() { return parse(decode(await getFile(CONTENT_PATH))); },
    async write(obj, message) { await putFile(CONTENT_PATH, Buffer.from(serialize(obj)), message); },
    async listBackups() {
      const commits = await gh(`/commits?path=${enc(CONTENT_PATH)}&sha=${enc(branch)}&per_page=31`);
      return commits.slice(1).map(c => ({ id: c.sha, time: c.commit.committer.date, label: c.commit.message.split("\n")[0] }));
    },
    async restore(id) {
      if (!/^[0-9a-f]{7,40}$/.test(id)) return null;
      const obj = parse(decode(await getFile(CONTENT_PATH, id)));
      await putFile(CONTENT_PATH, Buffer.from(serialize(obj)), `Restore site content from ${id.slice(0, 7)} (admin panel)`);
      return obj;
    },
    async upload(file, buf) {
      await putFile(`uploads/${file}`, buf, `Upload ${file} (admin panel)`);
      return `uploads/${file}`;
    }
  };
}

module.exports = { githubStorage };
