# Jazaa

A comparison site for UAE business cards and spend tools, with a password-protected editor at `/manage`.

- `/` is the public site.
- `/manage` shows only a sign-in form. After you sign in, you can edit providers, lists, questions, all page text and the logo.
- Edits are saved to Netlify Blobs (built in, nothing to set up) and appear on the public site immediately.

## Deploy to Netlify (about 5 minutes)

You need Node 18 or newer and a free Netlify account.

1. Unzip this folder and open a terminal inside it.
2. Install and sign in:
   ```
   npm install
   npx netlify login
   ```
3. Create the site and deploy:
   ```
   npx netlify init
   npx netlify deploy --prod
   ```
   (`init` can also connect a GitHub repository so every push deploys automatically.)
4. Set your sign-in details, then redeploy once. In Netlify go to
   **Site configuration > Environment variables** and add:

   | Name | Value |
   |---|---|
   | `ADMIN_USER` | the username you want |
   | `ADMIN_PASSWORD` | a long, unique password |
   | `SESSION_SECRET` | any long random string |

   Or from the terminal:
   ```
   npx netlify env:set ADMIN_USER "your-username"
   npx netlify env:set ADMIN_PASSWORD "your-long-password"
   npx netlify env:set SESSION_SECRET "$(openssl rand -hex 32)"
   npx netlify deploy --prod
   ```
5. Open `https://your-site.netlify.app/manage` and sign in.

Do not use a short or guessable password such as `admin`. Anyone on the internet can reach the sign-in page.

Netlify's drag-and-drop uploader does not run functions, so use the CLI or Git as above.

## Run it on your computer

```
npm install
ADMIN_USER=me ADMIN_PASSWORD=test-password-123 npx netlify dev
```

Then open http://localhost:8888 and http://localhost:8888/manage.

## How it works

- `public/index.html` is the site. It loads its content from `/api/data`.
- `public/manage/index.html` is the editor.
- `netlify/functions/api.mjs` is the whole backend: public data, sign-in, protected saves and logo uploads.
- `public/data/default.json` is the starter content. It is used until you save your first edit, and by "Reset to starter content".
- Sessions last 8 hours and use a signed, HTTP-only cookie. Wrong passwords are slowed down by a one-second delay.

## Moving to Vercel instead

The public site and `/manage` page work on any static host. The backend in `netlify/functions/api.mjs` uses Netlify Blobs, so on Vercel it would need rewriting to use Vercel Blob or a database.
