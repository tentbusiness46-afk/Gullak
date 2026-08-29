// A single libSQL client instance shared across the app.
//
// @libsql/client speaks the same API whether DB_URL points at a local
// SQLite file (file:./data/gullak.db) or a remote Turso database
// (libsql://your-db-name.turso.io). Only the .env values change
// between local testing and deployment - no code changes needed.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const env = require('../config/env');

// For a local file URL, the parent folder must exist BEFORE the client
// is created, or the native SQLite backend fails with "unable to open
// database file" (SQLITE_CANTOPEN) - this can't rely on `npm run
// migrate` having been run first, since server.js also creates this
// same client on startup. Turso URLs (libsql://... or https://...)
// skip this entirely.
function ensureLocalDataDir() {
  if (!env.dbUrl.startsWith('file:')) return;
  const filePath = env.dbUrl.replace(/^file:/, '');
  const dir = path.dirname(path.resolve(filePath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
ensureLocalDataDir();

const db = createClient({
  url: env.dbUrl,
  authToken: env.dbAuthToken
});

module.exports = db;
