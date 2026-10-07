# Portfolio website

```
index.html            Home page
research/index.html   Research page (list + one page per paper: research/#001/ethical-leadership)
admin/                Admin panel
data/content.js       ALL site content (papers, profile, home page text). Written by the admin panel.
assets/               Shared styles and scripts for the public pages
uploads/              Files uploaded from the admin panel (photo, CV, PDFs)
server.js             Small server: serves the site and lets the admin panel save
.env                  Admin password (never published)
backups/              Automatic copy of data/content.js before every save (last 50)
```

## Editing the site

1. Open a terminal in this folder and run `node server.js`
2. Open http://localhost:8080/admin/ and sign in (the password is in `.env`)
3. Edit, then press **Save changes** (or Ctrl+S). The site updates immediately.

To change the password, edit `ADMIN_PASSWORD=` in `.env` and restart the server.

## Putting it online

**Option A: a host that runs Node.js** (Render, Railway, Fly.io, a VPS…).
Upload the whole folder, start command `node server.js`, and set the environment
variable `ADMIN_PASSWORD`. The admin panel then works online at `yourdomain.com/admin/`.
Use HTTPS. Note: some free hosts wipe files on redeploy, so keep a copy of
`data/content.js` (Settings & backups → Download content.js).

**Option B: a static host** (GitHub Pages, Netlify, cPanel hosting…).
Upload everything except `server.js`, `.env` and `backups/`. The public site works as is.
To edit, run `node server.js` on your own computer, make the changes, then upload the new
`data/content.js` (and any new files in `uploads/`). The online `/admin/` page also opens in
an offline mode that lets you edit and download `content.js`.
