// Applies schema.sql against whichever database DB_URL points at.
// Safe to run repeatedly - every statement is CREATE TABLE/INDEX IF
// NOT EXISTS, so re-running just confirms the schema is up to date.
//
// Usage:
//   npm run migrate
const fs = require('fs');
const path = require('path');
const db = require('./client'); // also ensures ./data exists for a local file URL
const env = require('../config/env');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const rawSchema = fs.readFileSync(schemaPath, 'utf8');

  // Strip full-line SQL comments before splitting on ';' - otherwise a
  // semicolon inside a comment (e.g. "note: do X; then Y") would wrongly
  // split one statement into two. Comments are only ever full lines in
  // this file, never inline after real SQL, so this is safe.
  const schema = rawSchema
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log('Applying ' + statements.length + ' schema statement(s) to ' + env.dbUrl + ' ...');

  for (const statement of statements) {
    await db.execute(statement);
  }

  console.log('Migration complete.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
