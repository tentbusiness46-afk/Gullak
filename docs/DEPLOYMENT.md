# Deployment (Render)

Assumes you've already completed `docs/TURSO_SETUP.md` - deploying
against a local SQLite file doesn't make sense once more than one server
instance needs to see the same data.

## Before deploying, anywhere

1. **Generate fresh production secrets** - don't reuse your local `.env`
   values:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   Run twice, use one result for `JWT_SECRET` and the other for
   `COOKIE_SECRET`.
2. **Set a real admin password** in `ADMIN_PASSWORD` - not the one from
   local testing.
3. **Set `COOKIE_SECURE=true`.** Render serves everything over `https://`,
   and browsers silently drop `secure` cookies over plain HTTP - if this
   is still `false` in production, login will look like it works and then
   the cookie just won't persist, which is a confusing bug to chase later.
4. **Set `NODE_ENV=production`.**
5. **Decide on `DEMO_OTP_MODE`.** Leave it `true` for a demo/investor
   walkthrough. Before any real user's phone number is used to access
   real money, set it `false` and wire up an actual SMS provider in
   `src/utils/otp.js` (there's a `TODO` marking exactly where) - shipping
   this to production with demo mode on means *anyone* who knows or
   guesses a phone number can log in with any 4-digit code.

## 1. Push this repo to GitHub

Render deploys straight from a connected GitHub repo. Commit everything
in `gullak-backend/` (the `.gitignore` already excludes `node_modules`,
`.env`, and the local `data/` folder) and push it.

## 2. Create the Web Service

1. Go to [render.com](https://render.com) - **New** - **Web Service**.
2. Connect the GitHub repo you just pushed.
3. Render should auto-detect Node - if asked:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Pick the free or lowest-tier plan for now - the app is lightweight and
   Turso does the heavy lifting on the database side.

## 3. Set environment variables

In the Web Service's **Environment** tab, add every variable from
`.env.example` with real production values:

```
NODE_ENV=production
DB_URL=libsql://your-db.turso.io
DB_AUTH_TOKEN=your-turso-token
JWT_SECRET=...
COOKIE_SECRET=...
COOKIE_SECURE=true
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
DEMO_OTP_MODE=true-or-false
```

Don't set `PORT` - Render provides its own `PORT` value automatically,
and `server.js` already reads `process.env.PORT` with a fallback, so it
picks that up with no changes needed.

## 4. Apply the schema to your production database

Do this once, from your own machine, before (or right after) the first
deploy - point a local `.env` at the same production `DB_URL` /
`DB_AUTH_TOKEN` temporarily and run:

```bash
npm run migrate
```

You only need to re-run this when `schema.sql` changes (new table/column) -
see "Keeping local and Turso in sync" in `docs/TURSO_SETUP.md`.

## 5. Deploy

Click **Create Web Service**. Render builds and starts it automatically,
and redeploys on every push to the branch you connected. Watch the
**Logs** tab for the startup message:

```
Gullak backend running at http://localhost:<port>
  Consumer app: http://localhost:<port>/
  Admin panel:  http://localhost:<port>/admin
  Agent panel:  http://localhost:<port>/agent
```

Render gives you a URL like `https://gullak-backend.onrender.com` -
that's your live app.

## 6. Smoke-test the three URLs

```bash
curl -I https://your-app.onrender.com/
curl -I https://your-app.onrender.com/admin
curl -I https://your-app.onrender.com/agent
```

All three should return `200`. Also confirm the legacy filenames bounce
to the clean URLs instead of ever being served directly:

```bash
curl -I https://your-app.onrender.com/index.html   # expect 301 -> /
curl -I https://your-app.onrender.com/admin.html   # expect 301 -> /admin
curl -I https://your-app.onrender.com/agent.html   # expect 301 -> /agent
```

Then confirm the admin login works end-to-end with the same `curl`
sequence from `docs/LOCAL_SETUP.md` step 6, just against your Render URL
and production credentials instead of localhost.

## Notes specific to Render's free tier

- Free-tier services **spin down after periods of inactivity** and take
  a few seconds to wake back up on the next request - fine for a demo,
  worth upgrading to a paid instance before any real usage where that
  delay would be a problem.
- Render's filesystem is not guaranteed to persist across deploys or
  restarts on free/starter instances - another reason the database has
  to be Turso (or otherwise external) in production, and exactly why
  `data/gullak.db` is local-only and gitignored rather than something the
  deployed app relies on.
