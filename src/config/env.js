// Loads and validates environment variables once, at startup, so every
// other module can just `require('../config/env')` and trust the
// values are present instead of re-reading process.env everywhere.
require('dotenv').config();

const required = ['JWT_SECRET', 'COOKIE_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    '\nMissing required environment variable(s): ' + missing.join(', ') +
    '\nCopy .env.example to .env and fill these in before starting the server.\n'
  );
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  dbUrl: process.env.DB_URL || 'file:./data/gullak.db',
  dbAuthToken: process.env.DB_AUTH_TOKEN || undefined,

  jwtSecret: process.env.JWT_SECRET,
  cookieSecret: process.env.COOKIE_SECRET,
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  adminEmail: process.env.ADMIN_EMAIL.toLowerCase().trim(),
  adminPassword: process.env.ADMIN_PASSWORD,

  demoOtpMode: process.env.DEMO_OTP_MODE !== 'false'
};
