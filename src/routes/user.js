const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/client');
const env = require('../config/env');
const { signToken } = require('../utils/jwt');
const { sendOtp, verifyOtp } = require('../utils/otp');
const { requireUser, COOKIE_NAMES } = require('../middleware/auth');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

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

function isValidPhone(phone) {
  return /^\d{10}$/.test(String(phone || ''));
}

// ---------- main app login (phone + OTP) ----------
// Works for ANY 10-digit phone, registered customer or not - the app
// itself (offers, calculator, plan info) is browsable by anyone. Only
// /api/wallet checks whether the phone belongs to an actual customer.

router.post('/auth/send-otp', otpLimiter, asyncRoute(async (req, res) => {
  const { phone } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });

  await sendOtp(phone, 'login');
  res.json({ sent: true });
}));

router.post('/auth/verify-otp', asyncRoute(async (req, res) => {
  const { phone, code } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });

  const ok = await verifyOtp(phone, code, 'login');
  if (!ok) return res.status(401).json({ error: 'Incorrect or expired code' });

  const userResult = await db.execute({ sql: 'SELECT id, name FROM users WHERE phone = ?', args: [phone] });
  const user = userResult.rows[0] || null;

  const token = signToken('user', {
    phone,
    userId: user ? user.id : null,
    walletUnlocked: false
  });
  res.cookie(COOKIE_NAMES.user, token, cookieOptions());
  res.json({ phone, isRegisteredCustomer: !!user });
}));

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.user);
  res.json({ ok: true });
});

router.get('/auth/me', requireUser, (req, res) => {
  res.json({
    phone: req.auth.phone,
    isRegisteredCustomer: !!req.auth.userId,
    walletUnlocked: !!req.auth.walletUnlocked
  });
});

// ---------- wallet OTP gate (second factor, once per session) ----------

router.post('/wallet/send-otp', requireUser, otpLimiter, asyncRoute(async (req, res) => {
  await sendOtp(req.auth.phone, 'wallet');
  res.json({ sent: true });
}));

router.post('/wallet/verify-otp', requireUser, asyncRoute(async (req, res) => {
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

router.get('/wallet', requireUser, asyncRoute(async (req, res) => {
  if (!req.auth.walletUnlocked) {
    return res.status(401).json({ error: 'Wallet OTP verification required' });
  }

  if (!req.auth.userId) {
    // Phone isn't linked to a customer record yet - matches the "new
    // user, blank wallet, call admin to get set up" flow.
    return res.json({ hasActivePlans: false, profile: null, plans: [] });
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
router.get('/wallet/receipts/:planId', requireUser, asyncRoute(async (req, res) => {
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