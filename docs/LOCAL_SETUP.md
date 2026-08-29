# Local Setup & Testing

Gets you running at `http://localhost:3000` against a local SQLite file -
no Turso account needed for this part.

## 1. Prerequisites

- Node.js 18 or newer (`node --version`)
- npm (comes with Node)

## 2. Install dependencies

```bash
cd gullak-backend
npm install
```

This installs everything in `package.json`, including `@libsql/client`
(the database driver) and `nodemon` (dev-only auto-restart).

## 3. Create your `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in real values for these four - the server refuses
to start without them:

```
JWT_SECRET=...
COOKIE_SECRET=...
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
```

Generate strong random secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run that twice and paste one result into `JWT_SECRET`, the other into
`COOKIE_SECRET`. Pick any email/password you'll remember for
`ADMIN_EMAIL` / `ADMIN_PASSWORD` - this becomes the only admin login.

Leave `DB_URL=file:./data/gullak.db` as-is for local testing - that's
the whole point of using libSQL, the exact same code will later point
at Turso just by changing this one value.

## 4. Create the database tables

```bash
npm run migrate
```

This creates `data/gullak.db` (the folder is created automatically) and
applies every table/index in `src/db/schema.sql`. Safe to re-run any
time - every statement is `IF NOT EXISTS`.

Confirm your admin credentials are picked up correctly:

```bash
npm run seed:check
```

## 5. Start the server

```bash
npm run dev
```

(`npm run dev` uses nodemon, so it restarts automatically when you edit
a file. Use `npm start` for a plain, no-restart run.)

You should see:

```
Gullak backend running at http://localhost:3000
  Consumer app: http://localhost:3000/
  Admin panel:  http://localhost:3000/admin
  Agent panel:  http://localhost:3000/agent
  OTP is in DEMO MODE - the correct code is always the phone's last 4 digits, real codes are logged above each request.
```

Open all three URLs in your browser and confirm each one loads.

## 6. Log in as admin and seed your first agent + user

The admin panel is fully wired to the real API now, so just use it
directly:

1. Visit `http://localhost:3000/admin` and log in with the
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`.
2. Click **Agents** in the sidebar, then **+ New Agent**. Fill in a
   name, phone, email, and password (this becomes that agent's login
   at `/agent`).
3. Click **Users** in the sidebar, then **+ New User**. Fill in a name,
   phone, pick a plan type and amount, and assign the agent you just
   created. This creates both the user and their first plan in one step.
4. Click into that user's row (opens their profile in a new tab) to
   confirm the plan shows up with the right numbers, and click into the
   agent's row to confirm the customer is assigned.
5. Visit `http://localhost:3000/agent` and log in with the agent
   credentials from step 2 - you should see that customer in today's
   collection list (for Daily/Monthly plans) or the one-time investments
   table (for Fixed).

If you'd rather script this instead of clicking through it (useful for
seeding a lot of test data at once), every one of these is also a plain
API call - see `docs/API_REFERENCE.md` for the exact request shapes.

## Everyday local dev after the first setup

You only need to redo the agent/user seeding in step 6 once. After that, day-to-day:

```bash
npm run dev
```

If you ever want to start completely fresh:

```bash
rm data/gullak.db
npm run migrate
```

## Troubleshooting

- **"Missing required environment variable(s)"** on startup - you
  haven't filled in `.env` yet, or it's not in the project root. Re-check
  step 3.
- **`SQLITE_CANTOPEN` or similar on migrate** - the `data/` folder
  couldn't be created/written. Check you're running `npm run migrate`
  from the `gullak-backend` folder itself, and that you have write
  permission there.
- **Cookies don't seem to stick between requests in the browser** -
  check `COOKIE_SECURE` is `false` in `.env` for local `http://`
  testing. Secure cookies are silently dropped by browsers over plain
  HTTP, only `https://` (production) should set this to `true`.
