const express = require('express');
const db = require('../db/client');
const env = require('../config/env');
const { signToken } = require('../utils/jwt');
const { comparePassword } = require('../utils/password');
const { genId } = require('../utils/ids');
const { requireAgent, COOKIE_NAMES } = require('../middleware/auth');
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

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------- auth ----------

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const result = await db.execute({
    sql: 'SELECT * FROM agents WHERE email = ?',
    args: [String(email).toLowerCase().trim()]
  });
  const agent = result.rows[0];
  if (!agent) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await comparePassword(password, agent.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken('agent', { id: agent.id, email: agent.email, name: agent.name });
  res.cookie(COOKIE_NAMES.agent, token, cookieOptions());
  res.json({ id: agent.id, name: agent.name, email: agent.email });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.agent);
  res.json({ ok: true });
});

router.get('/me', requireAgent, (req, res) => {
  res.json({ id: req.auth.id, name: req.auth.name, email: req.auth.email });
});

// ---------- customers assigned to this agent ----------

router.get('/customers', requireAgent, asyncRoute(async (req, res) => {
  const usersResult = await db.execute({
    sql: 'SELECT id, name, phone, account_number FROM users WHERE agent_id = ? ORDER BY name',
    args: [req.auth.id]
  });
  const users = usersResult.rows;
  if (!users.length) return res.json({ recurring: [], oneTime: [] });

  const ids = users.map((u) => u.id);
  const placeholders = ids.map(() => '?').join(',');

  const plansResult = await db.execute({
    sql: `SELECT * FROM plans WHERE user_id IN (${placeholders}) AND status = 'active'`,
    args: ids
  });

  const today = todayStr();
  const recurringPlanIds = plansResult.rows.filter((p) => p.type !== 'fixed').map((p) => p.id);
  let todaysCollections = [];
  if (recurringPlanIds.length) {
    const cPlaceholders = recurringPlanIds.map(() => '?').join(',');
    const cResult = await db.execute({
      sql: `SELECT * FROM collections WHERE plan_id IN (${cPlaceholders}) AND collected_on = ?`,
      args: [...recurringPlanIds, today]
    });
    todaysCollections = cResult.rows;
  }
  const collectedByPlan = todaysCollections.reduce((acc, c) => {
    acc[c.plan_id] = c;
    return acc;
  }, {});

  const usersById = users.reduce((acc, u) => { acc[u.id] = u; return acc; }, {});

  const recurring = plansResult.rows
    .filter((p) => p.type !== 'fixed')
    .map((p) => {
      const user = usersById[p.user_id];
      const todays = collectedByPlan[p.id];
      const amount = p.type === 'daily' ? p.daily_amount : p.monthly_installment;
      return {
        planId: p.id,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone,
        type: p.type,
        amount,
        todayStatus: todays ? todays.status : 'pending'
      };
    });

  const oneTime = plansResult.rows
    .filter((p) => p.type === 'fixed')
    .map((p) => {
      const user = usersById[p.user_id];
      return {
        planId: p.id,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone,
        amount: p.fixed_amount,
        durationMonths: p.fixed_duration_months,
        startedAt: p.started_at
      };
    });

  res.json({ recurring, oneTime });
}));

// Mark today's collection as paid/missed for a daily or monthly plan.
router.post('/collections', requireAgent, asyncRoute(async (req, res) => {
  const { planId, status, amount } = req.body || {};
  if (!planId || !['paid', 'missed'].includes(status)) {
    return res.status(400).json({ error: 'planId and a valid status are required' });
  }

  const planResult = await db.execute({
    sql: `SELECT p.*, u.agent_id FROM plans p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    args: [planId]
  });
  const plan = planResult.rows[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  if (plan.agent_id !== req.auth.id) {
    return res.status(403).json({ error: 'This customer is not assigned to you' });
  }

  const today = todayStr();
  const finalAmount = amount || (plan.type === 'daily' ? plan.daily_amount : plan.monthly_installment);

  await db.execute({
    sql: `INSERT INTO collections (id, plan_id, user_id, agent_id, amount, status, collected_on)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(plan_id, collected_on) DO UPDATE SET status = excluded.status, amount = excluded.amount`,
    args: [genId(), planId, plan.user_id, req.auth.id, finalAmount, status, today]
  });

  res.json({ ok: true, planId, status, date: today });
}));

// Single customer detail (only if assigned to this agent).
router.get('/customers/:userId', requireAgent, asyncRoute(async (req, res) => {
  const userResult = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ? AND agent_id = ?',
    args: [req.params.userId, req.auth.id]
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'Customer not found' });

  const plansResult = await db.execute({
    sql: 'SELECT * FROM plans WHERE user_id = ?',
    args: [user.id]
  });

  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    accountNumber: user.account_number,
    plans: plansResult.rows
  });
}));

module.exports = router;
