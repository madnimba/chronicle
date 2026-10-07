/* ==========================================================================
   Admin panel.
   Server mode  (site run with `node server.js`): sign in, edits are saved
                straight to data/content.js, with automatic backups.
   Offline mode (site on a static host, no server): edits are kept in this
                browser, and "Download content.js" gives you the file to upload.
   ========================================================================== */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const DRAFT_KEY = "portfolio-admin-draft";

  const STATUS = {
    published: { label: "Published",                 journalLabel: "Journal" },
    accepted:  { label: "Accepted, forthcoming",     journalLabel: "Journal" },
    review:    { label: "Under review",              journalLabel: "Journal" },
    prep:      { label: "Manuscript in preparation", journalLabel: "Target journal" },
    working:   { label: "Working paper",             journalLabel: "Target journal" }
  };
  const VIEWS = {
    papers: "Papers", profile: "Profile & contact", home: "Home page",
    research: "Research page", settings: "Settings & backups"
  };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  let mode = "server";          // or "offline"
  let host = "local";           // where the server saves: "local" files or "github" (Vercel)
  let maxUpload = 15 * 1024 * 1024;
  let draft = null;             // content being edited
  let savedJSON = "";           // last saved/published version, for change tracking
  let view = "papers";
  let editing = -1;             // index of paper open in the editor, -1 = list
  let confirmDelete = -1;
  let search = "";
  const autoSlug = new WeakSet(); // new papers whose link name follows the title

  /* ---------------- Utilities ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3000);
  }
  function getPath(path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), draft);
  }
  function setPath(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const obj = keys.reduce((o, k) => (o[k] == null ? (o[k] = {}) : o[k]), draft);
    obj[last] = value;
  }
  function monthYear() { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
  function siteHref(u) {
    u = String(u || "");
    return /^(https?:|mailto:|\/|data:)/i.test(u) ? u : "../" + u;
  }
  function slugify(title) {
    const stop = new Set(["a", "an", "the", "of", "and", "or", "in", "on", "to", "for", "with", "by", "from", "when", "how", "why", "what", "through", "its", "is", "are", "as", "at", "into", "more", "less", "roles"]);
    const words = String(title || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(w => w && !stop.has(w));
    return words.slice(0, 4).join("-") || "paper";
  }
  function uniqueSlug(base, self) {
    let s = base, n = 2;
    while (draft.papers.some(p => p !== self && p.slug === s)) s = `${base}-${n++}`;
    return s;
  }
  function nextId() {
    const nums = draft.papers.map(p => parseInt(p.id, 10)).filter(n => !isNaN(n));
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(n).padStart(3, "0");
  }
  function me() { return { given: draft.profile.givenName || "", family: draft.profile.familyName || "" }; }
  function isMe(a) {
    const m = me();
    return a.family.trim().toLowerCase() === m.family.trim().toLowerCase() &&
      a.given.trim().toLowerCase() === m.given.trim().toLowerCase() && !!m.family;
  }
  function initials(g) { return String(g || "").trim().split(/\s+/).filter(Boolean).map(n => n[0].toUpperCase() + ".").join(" "); }
  function citeHTML(p) {
    const names = (p.authors || []).filter(a => a.family || a.given).map(a => {
      const t = esc(`${a.family}, ${initials(a.given)}`);
      return isMe(a) ? `<strong>${t}</strong>` : t;
    });
    let j = names[0] || "<em>No authors yet</em>";
    if (names.length === 2) j = `${names[0]}, &amp; ${names[1]}`;
    else if (names.length > 2) j = `${names.slice(0, -1).join(", ")}, &amp; ${names[names.length - 1]}`;
    return p.year ? `${j} (${esc(p.year)})` : j;
  }
  function normalize(c) {
    c.site = c.site || {}; c.profile = c.profile || {}; c.home = c.home || {}; c.research = c.research || {};
    c.papers = Array.isArray(c.papers) ? c.papers : [];
    c.profile.links = c.profile.links || [];
    ["interests", "education", "experience", "news"].forEach(k => { c.home[k] = c.home[k] || []; });
    c.research.topics = c.research.topics || [];
    if (c.site.autoDate === undefined) c.site.autoDate = true;
    c.papers.forEach(p => {
      p.authors = p.authors || []; p.keywords = p.keywords || [];
      ["submission", "doi", "url", "journal", "abdc", "sjr", "abstract"].forEach(k => { if (p[k] == null) p[k] = ""; });
      if (p.featured === undefined) p.featured = false;
      if (p.requestable === undefined) p.requestable = true;
    });
    return c;
  }
  function parseContentFile(text) {
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    return JSON.parse(text.slice(s, e + 1));
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function serialize(c) {
    return "/* Site content. Edit through the admin panel (/admin/), not by hand. */\n" +
      "window.SITE_CONTENT = " + JSON.stringify(c, null, 2) + ";\n";
  }

  /* ---------------- Server calls ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch("../api/" + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Admin": "1" },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401 && path !== "login") { showLogin("Your session has expired. Please sign in again."); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /* ---------------- Change tracking ---------------- */
  function isDirty() { return draft && JSON.stringify(draft) !== savedJSON; }
  function changed() {
    const dirty = isDirty();
    const st = $("save-state");
    st.classList.toggle("dirty", dirty);
    st.textContent = dirty ? "Unsaved changes" : (mode === "offline" ? "No changes since download" : "All changes saved");
    $("save-btn").disabled = mode === "server" && !dirty;
    $("paper-count").textContent = draft.papers.length;
    $("side-name").textContent = `${draft.profile.givenName || ""} ${draft.profile.familyName || ""}`.trim();
    if (mode === "offline") {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ time: Date.now(), content: draft, base: savedJSON })); } catch (e) { /* storage off */ }
    }
  }
  window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------------- Validation ---------------- */
  function validate() {
    const ids = new Set(), slugs = new Set();
    for (const [i, p] of draft.papers.entries()) {
      const n = `Paper ${i + 1}`;
      if (!String(p.title || "").trim()) return [i, `${n} has no title.`];
      if (!/^[A-Za-z0-9-]{1,20}$/.test(p.id || "")) return [i, `${n}: the tracking number may use only letters, digits and hyphens.`];
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || "")) return [i, `${n}: the link name may use only lowercase letters, digits and hyphens.`];
      if (ids.has(p.id)) return [i, `${n}: tracking number "${p.id}" is already used by another paper.`];
      if (slugs.has(p.slug)) return [i, `${n}: link name "${p.slug}" is already used by another paper.`];
      ids.add(p.id); slugs.add(p.slug);
      if (!p.authors.some(a => a.family.trim())) return [i, `${n} needs at least one author.`];
    }
    return null;
  }

  /* ---------------- Save ---------------- */
  async function save() {
    const bad = validate();
    if (bad) {
      toast(bad[1], true);
      view = "papers"; editing = bad[0]; render();
      return false;
    }
    // drop empty rows people may have left behind
    draft.papers.forEach(p => { p.authors = p.authors.filter(a => a.given.trim() || a.family.trim()); });
    draft.profile.links = draft.profile.links.filter(l => l.label.trim() || l.url.trim());
    if (draft.site.autoDate !== false) draft.site.lastUpdated = monthYear();

    if (mode === "offline") {
      download("content.js", serialize(draft), "text/javascript");
      savedJSON = JSON.stringify(draft);
      changed();
      toast("Downloaded content.js. Upload it to the data/ folder of your site.");
      return true;
    }
    const btn = $("save-btn");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await api("content", { method: "PUT", body: draft });
      savedJSON = JSON.stringify(draft);
      toast(host === "github" ? "Saved. Your website will update in about a minute." : "Saved. Your website is up to date.");
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    } finally {
      btn.textContent = "Save changes";
      changed();
    }
  }
  $("save-btn").addEventListener("click", save);
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && draft && !$("app").hidden) { e.preventDefault(); save(); }
  });

  /* ---------------- Generic field binding ----------------
     <input data-bind="profile.title">              text
     data-type="number" | "bool" | "csv"            other value types
     data-rerender                                  re-render the view after change */
  function bindAll(root) {
    root.querySelectorAll("[data-bind]").forEach(el => {
      const path = el.dataset.bind, type = el.dataset.type;
      const v = getPath(path);
      if (type === "bool") el.checked = !!v;
      else if (type === "csv") el.value = (v || []).join(", ");
      else el.value = v == null ? "" : v;
      const evt = (type === "bool" || el.tagName === "SELECT") ? "change" : "input";
      el.addEventListener(evt, () => {
        let val = el.value;
        if (type === "bool") val = el.checked;
        else if (type === "number") val = val === "" ? "" : Number(val);
        else if (type === "csv") val = val.split(",").map(s => s.trim()).filter(Boolean);
        setPath(path, val);
        if (el.dataset.rerender !== undefined) { const y = scrollY; render(); scrollTo(0, y); }
        else changed();
        root.dispatchEvent(new CustomEvent("fieldchange", { detail: path }));
      });
    });
    root.querySelectorAll("[data-chips]").forEach(el => chips(el, el.dataset.chips));
    root.querySelectorAll("[data-rows]").forEach(el => rows(el, el.dataset.rows, JSON.parse(el.dataset.fields)));
    root.querySelectorAll("[data-upload]").forEach(el => el.addEventListener("click", () => upload(el.dataset.upload, el.dataset.accept)));
    root.querySelectorAll("[data-wc]").forEach(el => {
      const target = root.querySelector(`[data-bind="${el.dataset.wc}"]`);
      const upd = () => { const n = (target.value.match(/\S+/g) || []).length; el.textContent = `${n} words`; };
      target.addEventListener("input", upd); upd();
    });
  }

  /* Tag-style list of short strings. */
  function chips(el, path) {
    const arr = getPath(path) || [];
    setPath(path, arr);
    el.innerHTML = arr.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(t)}">&times;</button></span>`).join("") +
      `<input type="text" placeholder="${arr.length ? "Add another…" : "Type and press Enter…"}">`;
    const input = el.querySelector("input");
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      arr.splice(Number(b.dataset.i), 1); chips(el, path); changed();
    }));
    const add = () => {
      const v = input.value.replace(/,$/, "").trim();
      if (v && !arr.includes(v)) { arr.push(v); chips(el, path); changed(); el.querySelector("input").focus(); }
      else input.value = "";
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
      else if (e.key === "Backspace" && !input.value && arr.length) { arr.pop(); chips(el, path); changed(); el.querySelector("input").focus(); }
    });
    input.addEventListener("blur", () => { if (input.value.trim()) add(); });
  }

  /* Repeatable groups of fields (education, news, links...). */
  function rows(el, path, fields) {
    const arr = getPath(path) || [];
    setPath(path, arr);
    const blank = () => Object.fromEntries(fields.map(f => [f.key, ""]));
    el.innerHTML = `<ul class="rows">${arr.map((item, i) => `
      <li>
        <div class="row-fields">${fields.map(f => `
          <div class="${f.wide ? "wide" : ""}">
            ${f.multiline
              ? `<textarea rows="2" data-bind="${path}.${i}.${f.key}" placeholder="${esc(f.placeholder || "")}" aria-label="${esc(f.label)}"></textarea>`
              : `<input type="text" data-bind="${path}.${i}.${f.key}" placeholder="${esc(f.placeholder || "")}" aria-label="${esc(f.label)}">`}
          </div>`).join("")}
        </div>
        <div class="row-tools">
          <button class="icon-btn" type="button" data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
          <button class="icon-btn" type="button" data-act="down" data-i="${i}" ${i === arr.length - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
          <button class="icon-btn del" type="button" data-act="del" data-i="${i}" aria-label="Remove">&times;</button>
        </div>
      </li>`).join("")}</ul>
      <button class="btn btn-sm" type="button" data-act="add">+ Add</button>`;
    bindAll(el.querySelector(".rows"));
    el.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => {
      const i = Number(b.dataset.i), act = b.dataset.act;
      if (act === "add") arr.push(blank());
      if (act === "del") arr.splice(i, 1);
      if (act === "up") [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (act === "down") [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      rows(el, path, fields); changed();
      if (act === "add") { const ins = el.querySelectorAll(".rows > li:last-child input, .rows > li:last-child textarea"); if (ins[0]) ins[0].focus(); }
    }));
  }

  /* File upload (server mode): stores the file in uploads/ and puts its path in the field. */
  function upload(path, accept) {
    if (mode !== "server") { toast("Uploading needs the site server. Paste a link instead.", true); return; }
    const input = $("file-input");
    input.accept = accept || ".pdf,.jpg,.jpeg,.png,.webp";
    input.value = "";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > maxUpload) { toast(`That file is larger than ${Math.round(maxUpload / 1048576)} MB. Compress it, or upload it elsewhere and paste the link.`, true); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          toast("Uploading…");
          const data = String(reader.result).split(",")[1];
          const r = await api("upload", { method: "POST", body: { name: file.name, data } });
          setPath(path, r.path);
          const y = scrollY; render(); scrollTo(0, y);
          toast(host === "github" ? "Uploaded. Save your changes; the file goes live with the next site update." : "Uploaded. Remember to save your changes.");
        } catch (e) { toast(e.message, true); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /* ---------------- Views ---------------- */
  function field(label, inner, hint) {
    return `<div class="f"><label>${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }
  const txt = (path, ph = "", extra = "") => `<input type="text" data-bind="${path}" placeholder="${esc(ph)}" ${extra}>`;
  const FORMAT_HINT = "Leave a blank line between paragraphs. Formatting: <code>*italic*</code>, <code>**bold**</code>, <code>[link text](https://…)</code>.";

  function render() {
    document.querySelectorAll(".nav-btn[data-view]").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === view)));
    $("view-title").textContent = view === "papers" && editing >= 0 ? (draft.papers[editing] ? "Edit paper" : "Papers") : VIEWS[view];
    const el = document.createElement("div");   // fresh root each time, so no listeners pile up
    if (view === "papers") el.innerHTML = editing >= 0 && draft.papers[editing] ? paperEditor() : paperList();
    else if (view === "profile") el.innerHTML = profileView();
    else if (view === "home") el.innerHTML = homeView();
    else if (view === "research") el.innerHTML = researchView();
    else el.innerHTML = settingsView();
    $("view").replaceChildren(el);
    bindAll(el);
    if (view === "papers") editing >= 0 && draft.papers[editing] ? wireEditor(el) : wireList(el);
    if (view === "settings") wireSettings(el);
    if (view === "profile") wireProfile(el);
    changed();
  }

  /* ----- Papers: list ----- */
  function paperList() {
    const q = search.trim().toLowerCase();
    const items = draft.papers.map((p, i) => ({ p, i })).filter(({ p }) => !q ||
      [p.title, p.journal, p.id, ...p.authors.map(a => a.given + " " + a.family)].join(" ").toLowerCase().includes(q));
    const list = items.map(({ p, i }) => `
      <li>
        <span class="pn">${i + 1}.</span>
        <div>
          <button class="pt" type="button" data-edit="${i}">${esc(p.title || "Untitled paper")}</button>
          <div class="pm">
            <span class="pill ${esc(p.status)}">${esc((STATUS[p.status] || {}).label || p.status)}</span>
            ${p.journal ? `<span>${esc(p.journal)}</span>` : ""}
            <span>#${esc(p.id)}</span>
            ${p.featured ? `<span class="star" title="Shown on the home page">&#9733; Home page</span>` : ""}
          </div>
        </div>
        <div class="pa">
          ${confirmDelete === i
            ? `<span class="confirm">Delete this paper?
                 <button class="btn btn-sm btn-danger-solid" type="button" data-del-yes="${i}">Delete</button>
                 <button class="btn btn-sm" type="button" data-del-no>Keep</button></span>`
            : `<button class="icon-btn" type="button" data-move="${i}" data-dir="-1" ${i === 0 || q ? "disabled" : ""} aria-label="Move up" title="Move up">&uarr;</button>
               <button class="icon-btn" type="button" data-move="${i}" data-dir="1" ${i === draft.papers.length - 1 || q ? "disabled" : ""} aria-label="Move down" title="Move down">&darr;</button>
               <button class="btn btn-sm" type="button" data-edit="${i}">Edit</button>
               <button class="icon-btn del" type="button" data-del="${i}" aria-label="Delete" title="Delete">&times;</button>`}
        </div>
      </li>`).join("");
    return `
      <div class="toolbar">
        <input type="search" id="search" placeholder="Search papers…" value="${esc(search)}" aria-label="Search papers">
        <span class="grow"></span>
        <button class="btn btn-primary" type="button" id="add-paper">+ Add paper</button>
      </div>
      ${draft.papers.length
        ? (items.length ? `<ul class="plist">${list}</ul>` : `<div class="card empty-state">No papers match “${esc(search)}”.</div>`)
        : `<div class="card empty-state">No papers yet. Use <strong>Add paper</strong> to create your first entry.</div>`}
      <p class="hint" style="margin-top:14px">Papers appear on the research page in this order, numbered 1, 2, 3… Use the arrows to reorder. Changes go live when you press <strong>Save changes</strong>.</p>`;
  }
  function wireList(el) {
    const s = el.querySelector("#search");
    s.addEventListener("input", () => { search = s.value; const pos = s.selectionStart; render(); const n = $("search"); n.focus(); n.setSelectionRange(pos, pos); });
    el.querySelector("#add-paper").addEventListener("click", addPaper);
    el.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => { editing = Number(b.dataset.edit); confirmDelete = -1; render(); scrollTo(0, 0); }));
    el.querySelectorAll("[data-move]").forEach(b => b.addEventListener("click", () => {
      const i = Number(b.dataset.move), j = i + Number(b.dataset.dir);
      [draft.papers[i], draft.papers[j]] = [draft.papers[j], draft.papers[i]];
      render();
    }));
    el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { confirmDelete = Number(b.dataset.del); render(); }));
    el.querySelectorAll("[data-del-no]").forEach(b => b.addEventListener("click", () => { confirmDelete = -1; render(); }));
    el.querySelectorAll("[data-del-yes]").forEach(b => b.addEventListener("click", () => {
      const p = draft.papers.splice(Number(b.dataset.delYes), 1)[0];
      confirmDelete = -1; render();
      toast(`Deleted “${(p.title || "Untitled").slice(0, 60)}”. Save to publish.`);
    }));
  }
  function addPaper() {
    const p = {
      id: nextId(), slug: "", title: "", year: new Date().getFullYear(),
      authors: [me()], abstract: "", status: "prep", journal: "", abdc: "", sjr: "",
      submission: "", doi: "", url: "", keywords: [], featured: false, requestable: true
    };
    autoSlug.add(p);
    draft.papers.push(p);
    editing = draft.papers.length - 1; search = "";
    render(); scrollTo(0, 0);
    const t = document.querySelector('[data-bind$=".title"]'); if (t) t.focus();
  }

  /* ----- Papers: editor ----- */
  function paperEditor() {
    const i = editing, p = draft.papers[i], P = `papers.${i}`;
    const s = STATUS[p.status] || STATUS.review;
    const isNew = autoSlug.has(p);
    const opt = (vals, cur) => vals.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
    return `
      <div class="editor-head">
        <button class="back-link" type="button" id="ed-back">&larr; All papers</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="../research/#${esc(p.id)}/${esc(p.slug)}" target="_blank" rel="noopener">Preview &nearr;</a>
          <button class="btn btn-primary" type="button" id="ed-save">${mode === "offline" ? "Download content.js" : "Save changes"}</button>
        </div>
      </div>

      <div class="card">
        <h3>Paper ${i + 1}${p.title ? "" : " (new)"}</h3>
        <p class="hint">Fields marked * are required.</p>
        ${field("Title *", `<textarea class="serif" rows="2" data-bind="${P}.title" placeholder="Full paper title"></textarea>`)}
        <div class="f">
          <span class="label">Authors *</span>
          <ul class="authors" id="authors"></ul>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm" type="button" id="add-author">+ Add author</button>
            <button class="btn btn-sm btn-ghost" type="button" id="add-me">+ Add myself</button>
          </div>
          <div class="hint" style="margin-top:8px">In publication order. Your own name is shown in bold automatically. Citation preview:</div>
          <div class="preview-cite" id="cite-preview">${citeHTML(p)}</div>
        </div>
        <div class="grid">
          ${field("Year", `<input type="number" min="1900" max="2100" data-bind="${P}.year" data-type="number">`)}
          ${field("Status", `<select data-bind="${P}.status" data-rerender>${opt(Object.entries(STATUS).map(([k, v]) => [k, v.label]), p.status)}</select>`)}
        </div>
        <div class="grid">
          ${field(s.journalLabel, txt(`${P}.journal`, "e.g. Journal of Consumer Research"))}
          ${(p.status === "prep" || p.status === "working") ? field("Expected submission", txt(`${P}.submission`, "e.g. December 2026")) : ""}
        </div>
        <div class="grid">
          ${field("ABDC ranking", `<select data-bind="${P}.abdc">${opt([["", "—"], ["A*", "A*"], ["A", "A"], ["B", "B"], ["C", "C"]], p.abdc)}</select>`)}
          ${field("SJR quartile", `<select data-bind="${P}.sjr">${opt([["", "—"], ["Q1", "Q1"], ["Q2", "Q2"], ["Q3", "Q3"], ["Q4", "Q4"]], p.sjr)}</select>`)}
        </div>
      </div>

      <div class="card">
        <div class="f">
          <label>Abstract <span class="wc" data-wc="${P}.abstract"></span></label>
          <textarea class="serif" rows="12" data-bind="${P}.abstract" placeholder="Paste the abstract here"></textarea>
        </div>
        ${field("Keywords", `<input type="text" data-bind="${P}.keywords" data-type="csv" placeholder="Separate with commas">`, "Optional. Shown on the paper's page.")}
      </div>

      <div class="card">
        <h3>Links &amp; visibility</h3>
        <p class="hint">Optional. Add these once the paper is published or posted.</p>
        <div class="grid">
          ${field("DOI", txt(`${P}.doi`, "10.1016/j.jbusres.2026.000000"))}
          <div class="f">
            <label>Link to the paper or PDF</label>
            <div class="inline-input">${txt(`${P}.url`, "https://…")}
              ${mode === "server" ? `<button class="btn" type="button" data-upload="${P}.url" data-accept=".pdf">Upload PDF</button>` : ""}</div>
            <div class="hint">Adds a “Read the paper” button.</div>
          </div>
        </div>
        <label class="check"><input type="checkbox" data-bind="${P}.featured" data-type="bool">
          <span>Show on the home page<small>Listed under “Selected research”.</small></span></label>
        <label class="check"><input type="checkbox" data-bind="${P}.requestable" data-type="bool">
          <span>Offer “Request extended abstract”<small>Visitors can ask you for the manuscript by email or form.</small></span></label>
      </div>

      <div class="card">
        <details class="adv">
          <summary>Link settings</summary>
          <div class="grid">
            ${field("Tracking number", txt(`${P}.id`, "e.g. 009", 'id="f-id"'))}
            ${field("Link name", txt(`${P}.slug`, "e.g. brand-trust", 'id="f-slug"'))}
          </div>
          <div class="hint">This paper's address: <code id="link-preview"></code></div>
          ${isNew ? `<div class="hint">The link name is created from the title. You can change it until you save.</div>`
                  : `<div class="warn-text">Changing these breaks links you have already shared for this paper.</div>`}
        </details>
      </div>

      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <button class="btn btn-danger" type="button" id="ed-delete">Delete paper</button>
        <button class="btn" type="button" id="ed-done">Done</button>
      </div>`;
  }
  function wireEditor(el) {
    const i = editing, p = draft.papers[i];
    const back = () => { editing = -1; render(); scrollTo(0, 0); };
    el.querySelector("#ed-back").addEventListener("click", back);
    el.querySelector("#ed-done").addEventListener("click", back);
    el.querySelector("#ed-save").addEventListener("click", save);
    let armed = false;
    el.querySelector("#ed-delete").addEventListener("click", e => {
      if (!armed) { armed = true; e.target.textContent = "Click again to delete"; e.target.classList.add("btn-danger-solid"); return; }
      draft.papers.splice(i, 1); editing = -1; render();
      toast("Paper deleted. Save to publish.");
    });

    const linkPreview = () => {
      el.querySelector("#link-preview").textContent = `${location.origin}/research/#${p.id}/${p.slug}`;
      const pv = el.querySelector('a[href^="../research/"]'); if (pv) pv.href = `../research/#${p.id}/${p.slug}`;
    };
    if (autoSlug.has(p) && !p.slug && p.title) { p.slug = uniqueSlug(slugify(p.title), p); el.querySelector("#f-slug").value = p.slug; }
    linkPreview();
    el.addEventListener("fieldchange", e => {
      if (e.detail.endsWith(".title") && autoSlug.has(p)) {
        p.slug = uniqueSlug(slugify(p.title), p);
        el.querySelector("#f-slug").value = p.slug;
      }
      if (e.detail.endsWith(".slug")) autoSlug.delete(p);
      if (e.detail.endsWith(".year")) el.querySelector("#cite-preview").innerHTML = citeHTML(p);
      linkPreview();
      changed();
    });

    const list = el.querySelector("#authors");
    const drawAuthors = () => {
      list.innerHTML = p.authors.map((a, k) => `
        <li>
          <span class="an">${k + 1}</span>
          <input type="text" data-k="${k}" data-f="given" value="${esc(a.given)}" placeholder="Given names" aria-label="Given names">
          <input type="text" data-k="${k}" data-f="family" value="${esc(a.family)}" placeholder="Family name" aria-label="Family name">
          ${isMe(a) ? `<span class="me-tag">You</span>` : ""}
          <button class="icon-btn" type="button" data-a="up" data-k="${k}" ${k === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
          <button class="icon-btn" type="button" data-a="down" data-k="${k}" ${k === p.authors.length - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
          <button class="icon-btn del" type="button" data-a="del" data-k="${k}" aria-label="Remove author">&times;</button>
        </li>`).join("");
      list.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
        p.authors[Number(inp.dataset.k)][inp.dataset.f] = inp.value;
        el.querySelector("#cite-preview").innerHTML = citeHTML(p);
        changed();
      }));
      list.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", () => {
        const k = Number(b.dataset.k), a = p.authors;
        if (b.dataset.a === "del") a.splice(k, 1);
        if (b.dataset.a === "up") [a[k - 1], a[k]] = [a[k], a[k - 1]];
        if (b.dataset.a === "down") [a[k + 1], a[k]] = [a[k], a[k + 1]];
        drawAuthors(); changed();
      }));
      el.querySelector("#cite-preview").innerHTML = citeHTML(p);
    };
    drawAuthors();
    el.querySelector("#add-author").addEventListener("click", () => {
      p.authors.push({ given: "", family: "" }); drawAuthors(); changed();
      list.querySelector("li:last-child input").focus();
    });
    el.querySelector("#add-me").addEventListener("click", () => {
      if (p.authors.some(isMe)) { toast("You are already listed as an author."); return; }
      p.authors.push(me()); drawAuthors(); changed();
    });
  }

  /* ----- Profile ----- */
  function profileView() {
    const P = draft.profile;
    return `
      <div class="card">
        <h3>Name &amp; position</h3>
        <p class="hint">Your name appears in the site header and page titles, and is set in bold in every author list.</p>
        <div class="grid">
          ${field("Given names", txt("profile.givenName"))}
          ${field("Family name", txt("profile.familyName"))}
        </div>
        <div class="grid">
          ${field("Title or position", txt("profile.title", "e.g. PhD candidate in Marketing"))}
          ${field("Affiliation", txt("profile.affiliation", "e.g. North South University"))}
        </div>
        ${field("Location", txt("profile.location", "City, Country"))}
      </div>

      <div class="card">
        <h3>Photo</h3>
        <p class="hint">Optional. A portrait shown beside your name on the home page (a 4:5 crop works best).</p>
        <div class="photo-row">
          ${P.photo ? `<img src="${esc(siteHref(P.photo))}" alt="">` : `<div class="ph">No photo</div>`}
          <div>
            <div class="inline-input">${txt("profile.photo", "Image link, or upload")}
              ${mode === "server" ? `<button class="btn" type="button" data-upload="profile.photo" data-accept=".jpg,.jpeg,.png,.webp">Upload</button>` : ""}</div>
            ${P.photo ? `<button class="btn btn-sm btn-ghost" type="button" id="rm-photo" style="margin-top:8px">Remove photo</button>` : ""}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Contact</h3>
        ${field("Email", `<input type="email" data-bind="profile.email" placeholder="you@university.edu">`, "Shown on the home page and used for extended-abstract requests.")}
        <div class="f">
          <label>CV</label>
          <div class="inline-input">${txt("profile.cvUrl", "Link to your CV, or upload a PDF")}
            ${mode === "server" ? `<button class="btn" type="button" data-upload="profile.cvUrl" data-accept=".pdf">Upload PDF</button>` : ""}</div>
          <div class="hint">When set, a “CV” link appears in the site menu.</div>
        </div>
      </div>

      <div class="card">
        <h3>Academic profiles</h3>
        <p class="hint">Google Scholar, ORCID, ResearchGate, LinkedIn, SSRN… Entries without a link are hidden.</p>
        <div data-rows="profile.links" data-fields='[{"key":"label","label":"Name","placeholder":"e.g. Google Scholar"},{"key":"url","label":"Link","placeholder":"https://…"}]'></div>
      </div>`;
  }
  function wireProfile(el) {
    const rm = el.querySelector("#rm-photo");
    if (rm) rm.addEventListener("click", () => { draft.profile.photo = ""; render(); });
  }

  /* ----- Home page ----- */
  function homeView() {
    return `
      <div class="card">
        <h3>Introduction</h3>
        ${field("Tagline", `<textarea class="serif" rows="2" data-bind="home.tagline"></textarea>`, "One or two sentences under your name.")}
        ${field("About", `<textarea class="serif" rows="9" data-bind="home.bio"></textarea>`, FORMAT_HINT)}
      </div>
      <div class="card">
        <h3>Research interests</h3>
        <p class="hint">Press Enter after each one.</p>
        <div class="chips" data-chips="home.interests"></div>
      </div>
      <div class="card">
        <h3>Selected research</h3>
        <p class="hint">Papers marked “Show on the home page” are listed, in research-page order. If none are marked, the first papers are shown.</p>
        ${field("Number of papers to show", `<input type="number" min="1" max="20" data-bind="home.featuredCount" data-type="number" style="max-width:120px">`)}
      </div>
      <div class="card">
        <h3>News</h3>
        <p class="hint">Short updates such as acceptances, talks and awards, newest first. The section is hidden when empty.</p>
        <div data-rows="home.news" data-fields='[{"key":"date","label":"Date","placeholder":"e.g. Sep 2026"},{"key":"text","label":"Update","placeholder":"What happened","wide":true,"multiline":true}]'></div>
      </div>
      <div class="card">
        <h3>Education</h3>
        <p class="hint">Hidden when empty.</p>
        <div data-rows="home.education" data-fields='[{"key":"main","label":"Degree","placeholder":"e.g. BBA in Marketing, North South University","wide":true},{"key":"when","label":"Years","placeholder":"e.g. 2020 – 2024"},{"key":"sub","label":"Details","placeholder":"Optional: thesis, honours, advisor"}]'></div>
      </div>
      <div class="card">
        <h3>Experience</h3>
        <p class="hint">Research, teaching or professional positions. Hidden when empty.</p>
        <div data-rows="home.experience" data-fields='[{"key":"main","label":"Position","placeholder":"e.g. Research Assistant, North South University","wide":true},{"key":"when","label":"Years","placeholder":"e.g. 2024 – present"},{"key":"sub","label":"Details","placeholder":"Optional"}]'></div>
      </div>`;
  }

  /* ----- Research page ----- */
  function researchView() {
    return `
      <div class="card">
        <h3>Page header</h3>
        ${field("Introduction", `<textarea class="serif" rows="3" data-bind="research.intro"></textarea>`, "A sentence or two under the page heading.")}
        <div class="f"><label>Research topics</label><div class="chips" data-chips="research.topics"></div>
          <div class="hint">Shown as a line under the introduction.</div></div>
      </div>
      <div class="card">
        <h3>Paper pages</h3>
        <label class="check"><input type="checkbox" data-bind="research.showRanking" data-type="bool">
          <span>Show journal rankings (ABDC and SJR)</span></label>
        ${field("Note above the request button", `<textarea rows="2" data-bind="research.requestNote"></textarea>`)}
      </div>
      <div class="card">
        <h3>Request form</h3>
        <p class="hint">Visitors can always email you a pre-filled request. To also receive requests through the on-page form,
          create a free access key at <a href="https://web3forms.com" target="_blank" rel="noopener">web3forms.com</a> using your email address and paste it here.</p>
        ${field("Web3Forms access key", txt("research.formAccessKey", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"))}
      </div>`;
  }

  /* ----- Settings ----- */
  function settingsView() {
    return `
      <div class="card">
        <h3>Site details</h3>
        ${field("Search engine description", `<textarea rows="2" data-bind="site.description"></textarea>`, "A one-sentence summary used by search engines and link previews.")}
        ${field("Footer note", txt("site.footerNote", "Optional"))}
        <div class="grid">
          ${field("“Last updated” date", txt("site.lastUpdated", "e.g. October 2026"))}
          <div class="f"><span class="label">&nbsp;</span>
            <label class="check"><input type="checkbox" data-bind="site.autoDate" data-type="bool"><span>Set to the current month whenever I save</span></label></div>
        </div>
      </div>

      ${mode === "server" ? `
      <div class="card">
        <h3>Backups</h3>
        <p class="hint">${host === "github"
          ? "Every save is kept in your GitHub history; the last 30 versions are listed here. Restoring replaces the live site content."
          : "A copy of the previous version is kept every time you save (the last 50). Restoring replaces the live site content."}</p>
        <ul class="backups" id="backups"><li class="hint">Loading…</li></ul>
      </div>` : ""}

      <div class="card">
        <h3>Export &amp; import</h3>
        <p class="hint">Download all site content as a file, for safekeeping or to move it elsewhere. Importing loads a file into the editor; nothing is published until you save.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" type="button" id="export">Download content.js</button>
          <button class="btn" type="button" id="import">Import file…</button>
        </div>
      </div>

      ${mode === "server" ? `
      <div class="card">
        <h3>Password</h3>
        <p class="hint">${host === "github"
          ? "The admin password is the <code>ADMIN_PASSWORD</code> environment variable in Vercel (Project → Settings → Environment Variables). Change it there, then redeploy."
          : "The admin password is stored in the <code>.env</code> file in the site folder (line <code>ADMIN_PASSWORD=…</code>). Edit it there and restart the server to change it."}</p>
      </div>` : ""}`;
  }
  async function wireSettings(el) {
    el.querySelector("#export").addEventListener("click", () => download("content.js", serialize(draft), "text/javascript"));
    el.querySelector("#import").addEventListener("click", () => {
      const input = $("file-input");
      input.accept = ".js,.json"; input.value = "";
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return;
        try {
          const obj = parseContentFile(await f.text());
          if (!obj || !Array.isArray(obj.papers)) throw new Error("bad");
          draft = normalize(obj); render();
          toast("Imported. Review the content, then save to publish.");
        } catch (e) { toast("That file is not a valid content file.", true); }
      };
      input.click();
    });
    const ul = el.querySelector("#backups");
    if (!ul) return;
    try {
      const list = await api("backups");
      let armed = "";
      const draw = () => {
        ul.innerHTML = list.length ? list.map(b => `
          <li><span>${esc(new Date(b.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}${b.label ? ` <span class="hint">· ${esc(b.label)}</span>` : ""}</span>
            <button class="btn btn-sm ${armed === b.id ? "btn-danger-solid" : ""}" type="button" data-file="${esc(b.id)}">${armed === b.id ? "Confirm restore" : "Restore"}</button></li>`).join("")
          : `<li class="hint">No backups yet. One is made each time you save.</li>`;
        ul.querySelectorAll("[data-file]").forEach(b => b.addEventListener("click", async () => {
          if (armed !== b.dataset.file) { armed = b.dataset.file; draw(); return; }
          try {
            const obj = await api("restore", { method: "POST", body: { id: b.dataset.file } });
            draft = normalize(obj); savedJSON = JSON.stringify(draft);
            render(); toast("Backup restored and published.");
          } catch (e) { toast(e.message, true); }
        }));
      };
      draw();
    } catch (e) { ul.innerHTML = `<li class="hint">Could not load backups.</li>`; }
  }

  /* ---------------- Navigation ---------------- */
  document.querySelectorAll(".nav-btn[data-view]").forEach(b => b.addEventListener("click", () => {
    view = b.dataset.view; editing = -1; confirmDelete = -1;
    document.body.classList.remove("nav-open");
    render(); scrollTo(0, 0);
  }));
  $("menu-btn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("logout-btn").addEventListener("click", async () => {
    if (isDirty() && !$("logout-btn").dataset.armed) {
      $("logout-btn").dataset.armed = "1"; $("logout-btn").textContent = "Unsaved changes. Sign out anyway?"; return;
    }
    try { await api("logout", { method: "POST" }); } catch (e) { /* ignore */ }
    savedJSON = JSON.stringify(draft);
    location.reload();
  });

  /* ---------------- Start-up ---------------- */
  function showLogin(msg) {
    $("app").hidden = true; $("login").hidden = false;
    $("login-err").hidden = !msg; $("login-err").textContent = msg || "";
    $("pw").value = ""; $("pw").focus();
  }
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("login-btn");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await api("login", { method: "POST", body: { password: $("pw").value } });
      $("login").hidden = true;
      if (draft) { $("app").hidden = false; render(); }      // session expired mid-edit: keep the draft
      else await loadServer();
    } catch (err) {
      $("login-err").textContent = err.message; $("login-err").hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Sign in"; }
  });

  async function loadServer() {
    draft = normalize(await api("content"));
    savedJSON = JSON.stringify(draft);
    $("app").hidden = false;
    render();
  }

  function loadOffline() {
    mode = "offline";
    $("logout-btn").hidden = true;
    $("save-btn").textContent = "Download content.js";
    const s = document.createElement("script");
    s.src = "../data/content.js?v=" + Date.now();
    s.onload = () => {
      draft = normalize(JSON.parse(JSON.stringify(window.SITE_CONTENT || {})));
      savedJSON = JSON.stringify(draft);
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { /* ignore */ }
      const banner = $("mode-banner");
      banner.innerHTML = `<div class="banner"><strong>Offline editing.</strong> The site server is not running here, so changes cannot be published directly.
        When you're done, press <strong>Download content.js</strong> and upload that file to the <code>data/</code> folder of your website, replacing the old one.
        Your edits are kept in this browser until then.</div>`;
      if (stored && stored.content && JSON.stringify(stored.content) !== savedJSON) {
        banner.insertAdjacentHTML("beforeend", `<div class="banner" id="restore-banner">You have unsaved edits from ${esc(new Date(stored.time).toLocaleString())}.
          <div><button class="btn btn-sm btn-primary" id="rs-yes" type="button">Continue editing them</button><button class="btn btn-sm" id="rs-no" type="button">Discard</button></div></div>`);
        $("rs-yes").addEventListener("click", () => { draft = normalize(stored.content); $("restore-banner").remove(); render(); });
        $("rs-no").addEventListener("click", () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } $("restore-banner").remove(); });
      }
      $("app").hidden = false;
      render();
    };
    s.onerror = () => { document.body.innerHTML = `<p style="padding:40px">Could not load <code>data/content.js</code>.</p>`; };
    document.head.appendChild(s);
  }

  (async function init() {
    let status = null;
    try {
      const res = await fetch("../api/status", { credentials: "same-origin" });
      if (res.ok) status = await res.json();
    } catch (e) { /* no server */ }
    if (!status || !status.server) return loadOffline();
    host = status.host || "local";
    if (status.maxUpload) maxUpload = status.maxUpload;
    if (status.configError) { showLogin(status.configError); $("login-btn").disabled = true; return; }
    if (!status.authed) return showLogin();
    try { await loadServer(); } catch (e) { showLogin(e.message); }
  })();
})();
