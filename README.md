# Portfolio website

```
index.html            Home page
research/index.html   Research page (list + one page per paper: research/#001/ethical-leadership)
admin/                Admin panel
data/content.js       ALL site content (papers, profile, home page text). Written by the admin panel.
assets/               Shared styles and scripts for the public pages
uploads/              Files uploaded from the admin panel (photo, CV, PDFs)
api/                  Admin panel back end (used by Vercel and by server.js)
vercel.json           Vercel routing and headers
server.js             Local server, for editing on your own computer
.env                  Local admin password (never uploaded)
backups/              Local only: copy of data/content.js before every save
```

## Online on Vercel (edit at yourdomain.com/admin/)

When you press **Save changes**, the admin panel commits the change to your GitHub repository,
and Vercel redeploys the site automatically (about a minute). Your GitHub history is the backup list.

1. **Push this folder to a GitHub repository** (private is fine).
2. **Import it in Vercel**: Add New → Project → choose the repo → Framework Preset **Other** → Deploy.
3. **Create a GitHub token**: GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
   - Repository access: *Only select repositories* → this repository
   - Permissions → Repository permissions → **Contents: Read and write**
   - Pick an expiration (you will need to renew it when it expires)
4. **Add environment variables** in Vercel → Project → Settings → Environment Variables:

   | Name             | Value                                               |
   |------------------|-----------------------------------------------------|
   | `ADMIN_PASSWORD` | a long password of your choice                      |
   | `GITHUB_TOKEN`   | the token from step 3                               |
   | `GITHUB_REPO`    | `your-username/your-repo` (optional, auto-detected) |

5. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.
6. Open `https://your-site/admin/` and sign in.

Uploads are limited to 3 MB each on Vercel. For larger PDFs, put them elsewhere (e.g. Google Drive)
and paste the link.

## Editing on your own computer

1. Run `node server.js` in this folder
2. Open http://localhost:8080/admin/ (the password is in `.env`)
3. Save. If the site is on Vercel, then `git add . && git commit -m "Update" && git push`.

If you edit both online and locally, run `git pull` before editing locally, since online
edits are committed to GitHub.
