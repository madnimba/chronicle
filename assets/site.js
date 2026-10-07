/* ==========================================================================
   Shared helpers for the public pages. Content comes from data/content.js
   (window.SITE_CONTENT), which the admin panel writes.
   ========================================================================== */
(function () {
  const C = window.SITE_CONTENT || {};
  const profile = C.profile || {};
  const ME = { given: profile.givenName || "", family: profile.familyName || "" };

  const STATUS = {
    published: { label: "Published",                 journalLabel: "Journal" },
    accepted:  { label: "Accepted, forthcoming",     journalLabel: "Journal" },
    review:    { label: "Under review",              journalLabel: "Journal" },
    prep:      { label: "Manuscript in preparation", journalLabel: "Target journal" },
    working:   { label: "Working paper",             journalLabel: "Target journal" }
  };
  const STATUS_ORDER = ["published", "accepted", "review", "prep", "working"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^[\w./-][^:]*$/.test(u)) return u;          // relative path, no scheme
    return "";
  }
  /* Site-relative paths (e.g. uploads/cv.pdf) resolved from the current page. */
  function href(u, base) {
    const url = safeUrl(u);
    if (!url || /^(https?:|mailto:|\/|#)/i.test(url)) return url;
    return (base || "") + url;
  }
  /* Small inline markup: **bold**, *italic*, [text](url). Everything else is escaped. */
  function inline(s) {
    let h = esc(s);
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      const url = safeUrl(u.replace(/&amp;/g, "&"));
      return url ? `<a href="${esc(url)}">${t}</a>` : t;
    });
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return h;
  }
  /* Blank-line separated paragraphs. */
  function paragraphs(s) {
    return String(s || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
      .map(p => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  function fullName() { return `${ME.given} ${ME.family}`.trim(); }
  function initials(given) {
    return String(given || "").trim().split(/\s+/).filter(Boolean)
      .map(n => n[0].toUpperCase() + ".").join(" ");
  }
  function isMe(a) {
    return a && a.family.trim().toLowerCase() === ME.family.trim().toLowerCase()
      && a.given.trim().toLowerCase() === ME.given.trim().toLowerCase();
  }
  /* APA-style byline: Hassan, M., Saad, W. I., Ahmed, S., & Anam, S. R. (2026) */
  function citeHTML(p) {
    const names = (p.authors || []).map(a => {
      const t = esc(`${a.family}, ${initials(a.given)}`);
      return isMe(a) ? `<strong>${t}</strong>` : t;
    });
    let joined;
    if (names.length <= 1) joined = names[0] || "";
    else if (names.length === 2) joined = `${names[0]}, &amp; ${names[1]}`;
    else joined = `${names.slice(0, -1).join(", ")}, &amp; ${names[names.length - 1]}`;
    return p.year ? `${joined} (${esc(p.year)})` : joined;
  }
  /* Full names in publication order, own name in bold. */
  function authorsHTML(p) {
    return (p.authors || []).map(a => {
      const t = esc(`${a.given} ${a.family}`);
      return isMe(a) ? `<strong>${t}</strong>` : t;
    }).join(", ");
  }
  function statusHTML(p) {
    const s = STATUS[p.status] || { label: p.status };
    return `<span class="status status-${esc(p.status)}"><span class="status-dot" aria-hidden="true"></span>${esc(s.label)}</span>`;
  }
  function paperHref(p, base) { return `${base}research/#${encodeURIComponent(p.id)}/${encodeURIComponent(p.slug)}`; }

  /* Header and footer, shared by every public page. */
  function renderChrome(active) {
    const base = document.body.dataset.base || "";
    const header = document.getElementById("site-header");
    const nav = [
      ["home", "Home", base || "./"],
      ["research", "Research", `${base}research/`]
    ];
    if (profile.cvUrl) nav.push(["cv", "CV", href(profile.cvUrl, base)]);
    nav.push(["contact", "Contact", `${base || "./"}#contact`]);
    if (header) {
      header.innerHTML = `<div class="wrap">
        <a class="brand" href="${esc(base || "./")}">${esc(fullName())}</a>
        <nav class="site-nav" aria-label="Primary">${nav.map(([k, label, href]) =>
          `<a href="${esc(safeUrl(href) || "#")}"${k === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
      </div>`;
    }
    const footer = document.getElementById("site-footer");
    if (footer) {
      const site = C.site || {};
      const right = [site.footerNote ? inline(site.footerNote) : "",
        site.lastUpdated ? `Last updated ${esc(site.lastUpdated)}` : ""].filter(Boolean).join(" · ");
      footer.innerHTML = `<div class="wrap">
        <p>&copy; ${new Date().getFullYear()} ${esc(fullName())}</p>
        <p>${right}</p>
      </div>`;
    }
    const desc = document.querySelector('meta[name="description"]');
    if (desc && C.site && C.site.description) desc.setAttribute("content", C.site.description);
  }

  window.Site = {
    C, ME, STATUS, STATUS_ORDER, esc, safeUrl, href, inline, paragraphs, fullName,
    citeHTML, authorsHTML, statusHTML, paperHref, renderChrome
  };
})();
