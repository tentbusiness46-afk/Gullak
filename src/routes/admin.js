const express = require('express');
const crypto = require('crypto');
const db = require('../db/client');
const env = require('../config/env');
const { signToken } = require('../utils/jwt');
const { hashPassword } = require('../utils/password');
const { genId } = require('../utils/ids');
const { requireAdmin, COOKIE_NAMES } = require('../middleware/auth');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

// Timing-safe compare so login can't be brute-forced via response-time
// differences. Both sides must be equal length for timingSafeEqual, so
// pad/hash first.
function safeEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a)).digest();
  const bufB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------- auth ----------

// There is no admin table - the one admin account is defined by
// ADMIN_EMAIL / ADMIN_PASSWORD in .env and checked directly here.
router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const emailOk = safeEqual(String(email).toLowerCase().trim(), env.adminEmail);
  const passOk = safeEqual(String(password), env.adminPassword);

  if (!emailOk || !passOk) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken('admin', { email: env.adminEmail });
  res.cookie(COOKIE_NAMES.admin, token, cookieOptions());
  res.json({ email: env.adminEmail });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.admin);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.auth.email });
});

// ---------- dashboard ----------

router.get('/dashboard', requireAdmin, asyncRoute(async (req, res) => {
  const [userCount, agentCount, byType] = await Promise.all([
    db.execute('SELECT COUNT(*) AS n FROM users'),
    db.execute('SELECT COUNT(*) AS n FROM agents'),
    db.execute(`
      SELECT type,
             COUNT(*) AS plan_count,
             COALESCE(SUM(
               CASE type
                 WHEN 'daily' THEN daily_amount * daily_total_days
                 WHEN 'monthly' THEN monthly_total_amount
                 WHEN 'fixed' THEN fixed_amount
               END
             ), 0) AS total_amount
      FROM plans
      WHERE status = 'active'
      GROUP BY type
    `)
  ]);

  const totalInvestment = byType.rows.reduce((sum, r) => sum + Number(r.total_amount), 0);

  res.json({
    totalUsers: Number(userCount.rows[0].n),
    totalAgents: Number(agentCount.rows[0].n),
    totalInvestment,
    investmentByPlan: byType.rows.map((r) => ({
      type: r.type,
      planCount: Number(r.plan_count),
      totalAmount: Number(r.total_amount)
    }))
  });
}));

// ---------- users ----------

router.get('/users', requireAdmin, asyncRoute(async (req, res) => {
  const result = await db.execute(`
    SELECT u.id, u.name, u.phone, u.account_number, u.created_at,
           a.id AS agent_id, a.name AS agent_name
    FROM users u
    LEFT JOIN agents a ON a.id = u.agent_id
    ORDER BY u.created_at DESC
  `);

  const users = result.rows;
  const ids = users.map((u) => u.id);
  let plansByUser = {};
  let paidCountByPlan = {};

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const plansResult = await db.execute({
      sql: `SELECT * FROM plans WHERE user_id IN (${placeholders}) AND status = 'active'`,
      args: ids
    });
    plansByUser = plansResult.rows.reduce((acc, p) => {
      (acc[p.user_id] = acc[p.user_id] || []).push(p);
      return acc;
    }, {});

    const planIds = plansResult.rows.map((p) => p.id);
    if (planIds.length) {
      const planPlaceholders = planIds.map(() => '?').join(',');
      const countsResult = await db.execute({
        sql: `SELECT plan_id, COUNT(*) AS n FROM collections WHERE plan_id IN (${planPlaceholders}) AND status = 'paid' GROUP BY plan_id`,
        args: planIds
      });
      paidCountByPlan = countsResult.rows.reduce((acc, r) => {
        acc[r.plan_id] = Number(r.n);
        return acc;
      }, {});
    }
  }

  // Same "amount actually invested so far" logic used in the consumer
  // wallet: daily/monthly are paid-collections-so-far, fixed is the
  // full principal (it's a one-time deposit, not a recurring one).
  function investedForPlan(p) {
    const paidCount = paidCountByPlan[p.id] || 0;
    if (p.type === 'daily') return p.daily_amount * paidCount;
    if (p.type === 'monthly') return p.monthly_installment * paidCount;
    if (p.type === 'fixed') return p.fixed_amount;
    return 0;
  }

  res.json(users.map((u) => {
    const plans = plansByUser[u.id] || [];
    const totalInvested = plans.reduce((sum, p) => sum + investedForPlan(p), 0);
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      accountNumber: u.account_number,
      createdAt: u.created_at,
      agent: u.agent_id ? { id: u.agent_id, name: u.agent_name } : null,
      plans: plans.map((p) => p.type),
      totalInvested
    };
  }));
}));

router.post('/users', requireAdmin, asyncRoute(async (req, res) => {
  const { name, phone, agentId, accountNumber } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  if (!accountNumber || !String(accountNumber).trim()) {
    return res.status(400).json({ error: 'Account number is required' });
  }
  const trimmedAccountNumber = String(accountNumber).trim();

  const existingPhone = await db.execute({
    sql: 'SELECT id FROM users WHERE phone = ?',
    args: [phone]
  });
  if (existingPhone.rows.length) {
    return res.status(409).json({ error: 'A user with this phone number already exists' });
  }

  const existingAccount = await db.execute({
    sql: 'SELECT id FROM users WHERE account_number = ?',
    args: [trimmedAccountNumber]
  });
  if (existingAccount.rows.length) {
    return res.status(409).json({ error: 'A user with this account number already exists' });
  }

  const id = genId();

  await db.execute({
    sql: 'INSERT INTO users (id, name, phone, account_number, agent_id) VALUES (?, ?, ?, ?, ?)',
    args: [id, name, phone, trimmedAccountNumber, agentId || null]
  });

  res.status(201).json({ id, name, phone, accountNumber: trimmedAccountNumber });
}));

router.get('/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const userResult = await db.execute({
    sql: `SELECT u.*, a.name AS agent_name FROM users u
          LEFT JOIN agents a ON a.id = u.agent_id
          WHERE u.id = ?`,
    args: [req.params.id]
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const plansResult = await db.execute({
    sql: 'SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC',
    args: [user.id]
  });

  const collectionsResult = await db.execute({
    sql: `SELECT * FROM collections WHERE user_id = ? ORDER BY collected_on DESC LIMIT 60`,
    args: [user.id]
  });

  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    accountNumber: user.account_number,
    createdAt: user.created_at,
    agent: user.agent_id ? { id: user.agent_id, name: user.agent_name } : null,
    plans: plansResult.rows,
    recentCollections: collectionsResult.rows
  });
}));

// Add a new plan (DIP/MIP/FIP) to an existing user.
router.post('/users/:id/plans', requireAdmin, asyncRoute(async (req, res) => {
  const user = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [req.params.id] });
  if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

  const { type } = req.body || {};
  if (!['daily', 'monthly', 'fixed'].includes(type)) {
    return res.status(400).json({ error: 'type must be daily, monthly or fixed' });
  }

  const id = genId();
  const b = req.body;

  await db.execute({
    sql: `INSERT INTO plans (
            id, user_id, type,
            daily_amount, daily_total_days, daily_yearly_rate,
            monthly_total_amount, monthly_tenure_months, monthly_installment, monthly_offer_rate,
            fixed_amount, fixed_duration_months, fixed_offer_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, req.params.id, type,
      b.dailyAmount || null, b.dailyTotalDays || null, b.dailyYearlyRate || null,
      b.monthlyTotalAmount || null, b.monthlyTenureMonths || null, b.monthlyInstallment || null, b.monthlyOfferRate || null,
      b.fixedAmount || null, b.fixedDurationMonths || null, b.fixedOfferRate || null
    ]
  });

  res.status(201).json({ id, type });
}));

// ---------- agents ----------

router.get('/agents', requireAdmin, asyncRoute(async (req, res) => {
  const result = await db.execute(`
    SELECT a.id, a.name, a.email, a.phone, a.created_at,
           COUNT(u.id) AS customer_count
    FROM agents a
    LEFT JOIN users u ON u.agent_id = a.id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `);

  res.json(result.rows.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    createdAt: a.created_at,
    customerCount: Number(a.customer_count)
  })));
}));

router.post('/agents', requireAdmin, asyncRoute(async (req, res) => {
  const { name, phone, email, password } = req.body || {};
  if (!name || !phone || !email || !password) {
    return res.status(400).json({ error: 'Name, phone, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM agents WHERE email = ?',
    args: [String(email).toLowerCase().trim()]
  });
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An agent with this email already exists' });
  }

  const id = genId();
  const passwordHash = await hashPassword(password);

  await db.execute({
    sql: 'INSERT INTO agents (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)',
    args: [id, name, String(email).toLowerCase().trim(), phone, passwordHash]
  });

  res.status(201).json({ id, name, email, phone });
}));

router.get('/agents/:id', requireAdmin, asyncRoute(async (req, res) => {
  const agentResult = await db.execute({
    sql: 'SELECT id, name, email, phone, created_at FROM agents WHERE id = ?',
    args: [req.params.id]
  });
  const agent = agentResult.rows[0];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const customersResult = await db.execute({
    sql: 'SELECT id, name, phone, account_number FROM users WHERE agent_id = ? ORDER BY created_at DESC',
    args: [agent.id]
  });
  const customers = customersResult.rows;
  const ids = customers.map((c) => c.id);

  let plansByUser = {};
  let paidCountByPlan = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const plansResult = await db.execute({
      sql: `SELECT * FROM plans WHERE user_id IN (${placeholders}) AND status = 'active'`,
      args: ids
    });
    plansByUser = plansResult.rows.reduce((acc, p) => {
      (acc[p.user_id] = acc[p.user_id] || []).push(p);
      return acc;
    }, {});

    const planIds = plansResult.rows.map((p) => p.id);
    if (planIds.length) {
      const planPlaceholders = planIds.map(() => '?').join(',');
      const countsResult = await db.execute({
        sql: `SELECT plan_id, COUNT(*) AS n FROM collections WHERE plan_id IN (${planPlaceholders}) AND status = 'paid' GROUP BY plan_id`,
        args: planIds
      });
      paidCountByPlan = countsResult.rows.reduce((acc, r) => {
        acc[r.plan_id] = Number(r.n);
        return acc;
      }, {});
    }
  }

  function investedForPlan(p) {
    const paidCount = paidCountByPlan[p.id] || 0;
    if (p.type === 'daily') return p.daily_amount * paidCount;
    if (p.type === 'monthly') return p.monthly_installment * paidCount;
    if (p.type === 'fixed') return p.fixed_amount;
    return 0;
  }

  const customersWithPlans = customers.map((c) => {
    const plans = plansByUser[c.id] || [];
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      accountNumber: c.account_number,
      plans: plans.map((p) => p.type),
      totalInvested: plans.reduce((sum, p) => sum + investedForPlan(p), 0)
    };
  });

  res.json({ ...agent, customers: customersWithPlans });
}));

module.exports = router;