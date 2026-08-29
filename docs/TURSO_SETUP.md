# Connecting to Turso

Turso is a hosted libSQL (SQLite-compatible) database. Because the app
uses `@libsql/client` everywhere - never raw `sqlite3` - switching from
the local file to Turso is purely a `.env` change. No code changes, no
different queries, nothing app-specific to Turso anywhere in `src/`.

## 1. Install the Turso CLI

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

(macOS with Homebrew: `brew install tursodatabase/tap/turso`)

Restart your terminal if the command isn't found immediately, then confirm:

```bash
turso --version
```

## 2. Sign up / log in

```bash
turso auth signup
```

(or `turso auth login` if you already have an account). This opens a
browser to authenticate - no separate password to manage locally.

## 3. Create the database

Pick a name and a region close to where you'll deploy the backend:

```bash
turso db create gullak-db --region bom
```

(`bom` = Mumbai. Run `turso db locations` to see every available region
and pick whichever is closest to your users/deployment.)

## 4. Get the connection URL

```bash
turso db show gullak-db --url
```

This prints something like:

```
libsql://gullak-db-yourusername.turso.io
```

## 5. Create an auth token

```bash
turso db tokens create gullak-db
```

This prints a long JWT-looking string - that's your `DB_AUTH_TOKEN`.

> Tokens can be revoked and re-issued any time with
> `turso db tokens create gullak-db` again (the old one keeps working
> until you explicitly revoke it with `turso db tokens revoke`) - so
> it's safe to generate a fresh one per environment (local test /
> staging / production) instead of reusing one everywhere.

## 6. Update your `.env`

```
DB_URL=libsql://gullak-db-yourusername.turso.io
DB_AUTH_TOKEN=<the token from step 5>
```

## 7. Apply the schema to Turso

```bash
npm run migrate
```

Same command as local - it just runs against whatever `DB_URL` currently
points to. This creates all the tables on Turso.

Verify directly if you like:

```bash
turso db shell gullak-db "SELECT name FROM sqlite_master WHERE type='table';"
```

You should see `agents`, `users`, `plans`, `collections`, `otp_codes`.

## 8. Run the app against Turso

```bash
npm start
```

Everything else - `npm run seed:check`, the admin/agent/user API calls
in `docs/LOCAL_SETUP.md` and `docs/API_REFERENCE.md` - works identically,
just now persisting to Turso instead of the local file.

## Keeping local and Turso in sync as the schema changes

`schema.sql` is the single source of truth, and every statement in it is
`CREATE TABLE/INDEX IF NOT EXISTS`, so:

- Editing `schema.sql` to add a new table/column, then running
  `npm run migrate` against **both** `DB_URL` values (swap `.env` back
  and forth, or keep two `.env` files) keeps local and Turso structurally
  identical.
- This is a lightweight approach appropriate for a small schema like
  this one. If the schema grows to need actual column-altering
  migrations (renames, type changes, backfills) later, add a proper
  migration tool (e.g. `drizzle-kit` or `umzug`) at that point rather
  than extending the simple script here.

## Turso free-tier notes worth knowing

- The free tier includes a generous request/storage allowance that's
  more than enough for development and small-scale production - check
  [turso.tech/pricing](https://turso.tech/pricing) for current limits
  before scaling up.
- Databases can be copied for a staging environment:
  `turso db create gullak-staging --from-db gullak-db`.
- `turso db shell gullak-db` drops you into an interactive SQL prompt
  against the live remote database - useful for quick inspection, but
  be careful running destructive statements there.
