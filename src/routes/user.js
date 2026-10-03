const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/client');
const env = require('../config/env');
const { signToken } = require('../utils/jwt');
const { sendOtp, verifyOtp } = require('../utils/otp');
const { hashPassword, comparePassword } = require('../utils/password');
const { requireUser, COOKIE_NAMES } = require('../middleware/auth');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

// Password guessing is the main risk of a password login, so attempts
// are capped per IP. Wallet codes keep their own, separate cap.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' }
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please try again in a few minutes.' }
});

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

// Only customers who actually exist can be signed in now, so every
// authenticated route needs a userId in the session. This also means
// anyone still holding a session from the old phone-OTP login (which
// allowed unregistered numbers) is asked to log in again.
function requireRegistered(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ---------------------------------------------------------------
// users.password_hash
//
// Added to the users table the first time it's needed, so there is no
// separate migration to remember to run - existing databases (local or
// Turso) get the column automatically, and new ones get it on the first
// login attempt. Safe to run repeatedly.
// ---------------------------------------------------------------
let passwordColumnReady = null;
function ensurePasswordColumn() {
  if (!passwordColumnReady) {
    passwordColumnReady = (async () => {
      const info = await db.execute('PRAGMA table_info(users)');
      const hasColumn = info.rows.some((r) => r.name === 'password_hash');
      if (!hasColumn) {
        try {
          await db.execute('ALTER TABLE users ADD COLUMN password_hash TEXT');
        } catch (err) {
          // another server instance added it a moment earlier
          if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
      }
    })().catch((err) => {
      passwordColumnReady = null; // try again on the next request
      throw err;
    });
  }
  return passwordColumnReady;
}

// Registration numbers are whatever the admin typed when creating the
// customer, so match without caring about upper/lower case - but if two
// numbers differ only by case, the exact match wins.
async function findUserByRegistrationNumber(registrationNumber) {
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE LOWER(account_number) = LOWER(?)',
    args: [registrationNumber]
  });
  const rows = result.rows;
  if (!rows.length) return null;
  const exact = rows.find((r) => r.account_number === registrationNumber);
  if (exact) return exact;
  return rows.length === 1 ? rows[0] : null;
}

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // bcrypt only reads the first 72 bytes

// ---------- login: registration number + password ----------
//
// First login for a registration number: whatever password is entered
// is hashed and saved. Every login after that is checked against it.
router.post('/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const registrationNumber = String((req.body && req.body.registrationNumber) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!registrationNumber || !password) {
    return res.status(400).json({ error: 'Enter your registration number and password' });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'Password can be at most ' + MAX_PASSWORD_LENGTH + ' characters' });
  }

  await ensurePasswordColumn();

  const user = await findUserByRegistrationNumber(registrationNumber);
  const genericFailure = { error: 'Incorrect registration number or password' };
  if (!user) return res.status(401).json(genericFailure);

  let firstLogin = false;

  if (!user.password_hash) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: 'Choose a password with at least ' + MIN_PASSWORD_LENGTH + ' characters. It will be saved for your next logins.'
      });
    }
    const hash = await hashPassword(password);
    // The IS NULL guard means that if two first logins arrive at the same
    // moment, only one password is saved; the other is checked against it.
    const saved = await db.execute({
      sql: "UPDATE users SET password_hash = ? WHERE id = ? AND (password_hash IS NULL OR password_hash = '')",
      args: [hash, user.id]
    });
    if (saved.rowsAffected === 1) {
      firstLogin = true;
    } else {
      const fresh = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.id] });
      const storedHash = fresh.rows[0] && fresh.rows[0].password_hash;
      if (!storedHash || !(await comparePassword(password, storedHash))) {
        return res.status(401).json(genericFailure);
      }
    }
  } else {
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) return res.status(401).json(genericFailure);
  }

  const token = signToken('user', {
    phone: user.phone,
    userId: user.id,
    walletUnlocked: false
  });
  res.cookie(COOKIE_NAMES.user, token, cookieOptions());
  res.json({ phone: user.phone, firstLogin });
}));

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.user);
  res.json({ ok: true });
});

router.get('/auth/me', requireUser, requireRegistered, (req, res) => {
  res.json({
    phone: req.auth.phone,
    isRegisteredCustomer: true,
    walletUnlocked: !!req.auth.walletUnlocked
  });
});

// ---------- wallet OTP gate (second step, once per session) ----------
// Unchanged: the code goes to the phone number on file for the customer
// who just logged in.

router.post('/wallet/send-otp', requireUser, requireRegistered, otpLimiter, asyncRoute(async (req, res) => {
  await sendOtp(req.auth.phone, 'wallet');
  res.json({ sent: true });
}));

router.post('/wallet/verify-otp', requireUser, requireRegistered, asyncRoute(async (req, res) => {
  const { code } = req.body || {};
  const ok = await verifyOtp(req.auth.phone, code, 'wallet');
  if (!ok) return res.status(401).json({ error: 'Incorrect or expired code' });

  // Re-issue the same session as a user, just with walletUnlocked
  // flipped on, so this only needs to happen once per login session.
  const token = signToken('user', {
    phone: req.auth.phone,
    userId: req.auth.userId,
    walletUnlocked: true
  });
  res.cookie(COOKIE_NAMES.user, token, cookieOptions());
  res.json({ unlocked: true });
}));

// ---------- wallet content ----------

function round(n) {
  return Math.round(n * 100) / 100;
}

function buildDailyView(p) {
  const daysElapsed = Number(p.days_elapsed || 0);
  const investedTillNow = round(p.daily_amount * daysElapsed);
  const maturityTotal = p.daily_amount * p.daily_total_days;
  const maturityReturn = round(maturityTotal * (1 + p.daily_yearly_rate / 100));
  return {
    type: 'daily',
    startedAt: p.started_at,
    dailyAmount: p.daily_amount,
    investedTillNow,
    daysElapsed,
    totalDays: p.daily_total_days,
    totalReturnAtMaturity: maturityReturn
  };
}

function buildMonthlyView(p, installmentsPaid) {
  const maturity = round(p.monthly_total_amount * (1 + p.monthly_offer_rate / 100));
  return {
    type: 'monthly',
    totalAmount: p.monthly_total_amount,
    tenureMonths: p.monthly_tenure_months,
    monthlyInstallment: p.monthly_installment,
    installmentsPaid,
    totalReturnAtMaturity: maturity
  };
}

function buildFixedView(p) {
  const startedAt = new Date(p.started_at);
  const now = new Date();
  const elapsedMonths = Math.max(0, Math.min(
    p.fixed_duration_months,
    (now.getFullYear() - startedAt.getFullYear()) * 12 + (now.getMonth() - startedAt.getMonth())
  ));
  const profitSoFar = round(p.fixed_amount * (p.fixed_offer_rate / 100) * (elapsedMonths / p.fixed_duration_months));
  return {
    type: 'fixed',
    startedAt: p.started_at,
    amount: p.fixed_amount,
    durationMonths: p.fixed_duration_months,
    currentValue: round(p.fixed_amount + profitSoFar),
    principal: p.fixed_amount,
    profitSoFar
  };
}

router.get('/wallet', requireUser, requireRegistered, asyncRoute(async (req, res) => {
  if (!req.auth.walletUnlocked) {
    return res.status(401).json({ error: 'Wallet OTP verification required' });
  }

  const userResult = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.auth.userId] });
  const user = userResult.rows[0];
  if (!user) return res.json({ hasActivePlans: false, profile: null, plans: [] });

  const plansResult = await db.execute({
    sql: `SELECT * FROM plans WHERE user_id = ? AND status = 'active'`,
    args: [user.id]
  });

  const dailyPlan = plansResult.rows.find((p) => p.type === 'daily');
  const monthlyPlan = plansResult.rows.find((p) => p.type === 'monthly');
  const fixedPlan = plansResult.rows.find((p) => p.type === 'fixed');

  const views = [];

  if (dailyPlan) {
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM collections WHERE plan_id = ? AND status = 'paid'`,
      args: [dailyPlan.id]
    });
    views.push({ ...buildDailyView(dailyPlan), planId: dailyPlan.id, daysElapsed: Number(countResult.rows[0].n) });
  }
  if (monthlyPlan) {
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM collections WHERE plan_id = ? AND status = 'paid'`,
      args: [monthlyPlan.id]
    });
    views.push({ ...buildMonthlyView(monthlyPlan, Number(countResult.rows[0].n)), planId: monthlyPlan.id });
  }
  if (fixedPlan) {
    views.push({ ...buildFixedView(fixedPlan), planId: fixedPlan.id });
  }

  res.json({
    hasActivePlans: views.length > 0,
    profile: {
      name: user.name,
      accountNumber: user.account_number,
      phone: user.phone
    },
    plans: views
  });
}));

// Collection history for a single (daily) plan - powers the receipts
// calendar screen.
router.get('/wallet/receipts/:planId', requireUser, requireRegistered, asyncRoute(async (req, res) => {
  if (!req.auth.walletUnlocked) {
    return res.status(401).json({ error: 'Wallet OTP verification required' });
  }

  const planResult = await db.execute({
    sql: 'SELECT * FROM plans WHERE id = ? AND user_id = ?',
    args: [req.params.planId, req.auth.userId]
  });
  if (!planResult.rows.length) return res.status(404).json({ error: 'Plan not found' });

  const collectionsResult = await db.execute({
    sql: `SELECT c.id, c.collected_on, c.status, c.amount, c.method, a.name AS agent_name
          FROM collections c
          LEFT JOIN agents a ON a.id = c.agent_id
          WHERE c.plan_id = ?
          ORDER BY c.collected_on DESC`,
    args: [req.params.planId]
  });

  res.json({ receipts: collectionsResult.rows });
}));

module.exports = router;
