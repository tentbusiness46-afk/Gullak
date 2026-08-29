const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const env = require('./src/config/env');
const { errorHandler } = require('./src/middleware/errorHandler');
const { COOKIE_NAMES } = require('./src/middleware/auth');

const adminRoutes = require('./src/routes/admin');
const agentRoutes = require('./src/routes/agent');
const userRoutes = require('./src/routes/user');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------
// Clean URL page routes. Each of the 3 frontends is one self-contained
// HTML file (all CSS/JS/images inlined), so these are the ONLY static
// file routes the server needs - there is no public/ directory listing
// exposed and no *.html path is ever served or linked anywhere.
// ---------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});
app.get('/agent', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'agent.html'));
});

// If anyone hits the underlying filename directly, send them to the
// clean URL instead of serving it at that path - keeps the address bar
// (and every crawler/bookmark) consistently free of ".html".
app.get(['/index.html', '/gullak.html'], (req, res) => res.redirect(301, '/'));
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
app.get('/agent.html', (req, res) => res.redirect(301, '/agent'));

// Testing convenience only: visiting /logout clears every role's
// session cookie at once (admin, agent, and consumer) and sends you
// back to the front page signed out of all three - a quick full reset
// while testing, rather than logging out of each app individually.
// The real per-app logout buttons (POST /admin/api/logout etc.) are
// what the actual UIs use day to day.
app.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.admin);
  res.clearCookie(COOKIE_NAMES.agent);
  res.clearCookie(COOKIE_NAMES.user);
  res.redirect('/');
});

// ---------------------------------------------------------------
// API routes
// ---------------------------------------------------------------
app.use('/admin/api', adminRoutes);
app.use('/agent/api', agentRoutes);
app.use('/api', userRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Gullak backend running at http://localhost:${env.port}`);
  console.log(`  Consumer app: http://localhost:${env.port}/`);
  console.log(`  Admin panel:  http://localhost:${env.port}/admin`);
  console.log(`  Agent panel:  http://localhost:${env.port}/agent`);
  if (env.demoOtpMode) {
    console.log('  OTP is in DEMO MODE - the correct code is always the phone\'s last 4 digits, real codes are logged above each request.');
  }
});