# Gullak Backend

Node.js/Express backend for the three Gullak frontends already built:

| URL         | Serves                          | Who it's for                    |
|-------------|----------------------------------|----------------------------------|
| `/`         | `public/index.html`              | Consumer app (was `gullak.html`) |
| `/admin`    | `public/admin.html`              | Admin dashboard                  |
| `/agent`    | `public/agent.html`              | Agent dashboard                  |

No `.html` extension is ever exposed - `/index.html`, `/gullak.html`, `/admin.html`
and `/agent.html` all 301-redirect to their clean equivalents. See `server.js`.

## Stack

- **Express** - server + routing
- **`@libsql/client`** - one database driver that talks to a local SQLite
  file *and* to Turso (remote libSQL) with the same code, just a different
  connection URL. Local testing and production use the identical query
  code in `src/routes/*.js`.
- **JWT in httpOnly cookies** - one cookie per role (`gullak_admin_token`,
  `gullak_agent_token`, `gullak_user_token`), so an admin, an agent and a
  consumer user can all be logged in on the same browser simultaneously
  without clashing (matches the 3 separate frontends).
- **bcryptjs** - password hashing for agents (the only role with a
  stored password other than admin - see below).

## Where documentation lives

Read these in order:

1. **[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)** - get it running on your
   machine against a local SQLite file. Start here.
2. **[docs/TURSO_SETUP.md](docs/TURSO_SETUP.md)** - create a Turso database
   and point the app at it.
3. **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** - deploy to a real host.
4. **[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** - every route, what
   it expects, what it returns.

## The admin account is special

There is **no admin table** in the database. The one admin login is
defined entirely by `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` and checked
directly against those values on login - nothing to seed, nothing to
migrate, and rotating the password is just an env change + restart.

The admin panel's existing "+ New Agent" and "+ New User" forms are how
you create everything else - log in as admin first, then use those to
seed your first agent and first test user. See
[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for the exact walkthrough.

## Current status: fully wired, all three apps real

All three frontends now call the real backend - nothing left running on
`localStorage` or hardcoded demo data:

- **Consumer app** (`/`) - real phone+OTP login, session persists across
  reloads (sign-in only happens once), real wallet OTP gate, real
  registered-vs-new-user wallet content pulled from the database.
- **Admin** (`/admin`) - real login, live dashboard stats, Users/Agents
  tables, New User / New Agent creation, and both profile pages, all
  reading and writing through `/admin/api/*`.
- **Agent** (`/agent`) - real login, today's collection list with
  Paid/Missed marking that actually persists, one-time (Fixed plan)
  customer table.

**OTP, for now:** the correct code is always the phone number's last 4
digits (see `src/utils/otp.js`) - no real SMS provider is wired up yet.
Swap that in before any real user's phone number touches real money;
the file has a `TODO` marking exactly where.

**One thing intentionally dropped:** the old localStorage-based
cross-tab "live sync" (agent marks a payment, admin dashboard elsewhere
updates automatically) doesn't have a backend equivalent yet - a
manual refresh shows the latest data. Worth adding back via polling or
websockets if that live-sync behavior matters to you.

I could not run `npm install` in the sandbox this was built in (no
registry access) - every route was verified with `node --check` plus a
hand-built mock server exercising the actual frontend code end-to-end
(login, wrong-password errors, session persistence, CRUD, collection
marking). A real `npm run dev` smoke test on your machine is still the
genuine confirmation before you treat this as production-ready.

## Project layout

```
gullak-backend/
├── server.js                 Entry point - clean URL routes + API mounting
├── package.json
├── .env.example               Copy to .env and fill in
├── src/
│   ├── config/env.js          Loads + validates all env vars once
│   ├── db/
│   │   ├── schema.sql          Full table definitions
│   │   ├── client.js           libSQL client (local file or Turso)
│   │   ├── migrate.js          Applies schema.sql - run after every pull
│   │   └── checkAdmin.js       Sanity-checks admin env vars are set
│   ├── middleware/
│   │   ├── auth.js             requireAdmin / requireAgent / requireUser
│   │   └── errorHandler.js     asyncRoute wrapper + JSON error responses
│   ├── routes/
│   │   ├── admin.js            /admin/api/* - admin login, users, agents, dashboard
│   │   ├── agent.js            /agent/api/* - agent login, customers, collections
│   │   └── user.js             /api/*       - consumer OTP login, wallet, receipts
│   └── utils/
│       ├── jwt.js, password.js, ids.js, otp.js
├── public/
│   ├── index.html, admin.html, agent.html
└── docs/
```
