# API Reference

All routes return JSON. All authenticated routes read a role-specific
httpOnly cookie - `curl` examples below use a cookie jar (`-c cookies.txt`
to save, `-b cookies.txt` to send) to simulate that.

---

## Admin - `/admin/api/*`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/admin/api/login` | - | `{email, password}` | Checked against `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env`. Sets `gullak_admin_token` cookie. |
| POST | `/admin/api/logout` | admin | - | Clears the admin cookie. |
| GET | `/admin/api/me` | admin | - | `{email}` |
| GET | `/admin/api/dashboard` | admin | - | `{totalUsers, totalAgents, totalInvestment, investmentByPlan: [{type, planCount, totalAmount}]}` |
| GET | `/admin/api/users` | admin | - | List of all users with their agent, active plan types, and computed `totalInvested`. |
| POST | `/admin/api/users` | admin | `{name, phone, agentId?}` | Creates a user, generates their account number. |
| GET | `/admin/api/users/:id` | admin | - | Full profile: user info, all plans, recent collections. |
| POST | `/admin/api/users/:id/plans` | admin | see below | Adds a DIP/MIP/FIP plan to an existing user. |
| GET | `/admin/api/agents` | admin | - | List of all agents with customer counts. |
| POST | `/admin/api/agents` | admin | `{name, phone, email, password}` | Creates an agent (password is hashed). |
| GET | `/admin/api/agents/:id` | admin | - | Agent info + assigned customers, each with their plan types and computed `totalInvested`. |

**`POST /admin/api/users/:id/plans` body shape** (send only the fields for
the chosen `type`):

```json
// type: "daily"
{ "type": "daily", "dailyAmount": 200, "dailyTotalDays": 365, "dailyYearlyRate": 20 }

// type: "monthly"
{ "type": "monthly", "monthlyTotalAmount": 120000, "monthlyTenureMonths": 12,
  "monthlyInstallment": 10000, "monthlyOfferRate": 18 }

// type: "fixed"
{ "type": "fixed", "fixedAmount": 100000, "fixedDurationMonths": 12, "fixedOfferRate": 45 }
```

---

## Agent - `/agent/api/*`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/agent/api/login` | - | `{email, password}` | Sets `gullak_agent_token` cookie. |
| POST | `/agent/api/logout` | agent | - | Clears the agent cookie. |
| GET | `/agent/api/me` | agent | - | `{id, name, email}` |
| GET | `/agent/api/customers` | agent | - | `{recurring: [...], oneTime: [...]}` - see below. |
| POST | `/agent/api/collections` | agent | `{planId, status, amount?}` | Marks today's collection `paid` or `missed` for a daily/monthly plan. Upserts - calling it twice for the same plan today just updates the status. |
| GET | `/agent/api/customers/:userId` | agent | - | One customer's full plan list (must be assigned to this agent). |

**`GET /agent/api/customers` response shape:**

```json
{
  "recurring": [
    { "planId": "...", "userId": "...", "userName": "Aarti Deshmukh",
      "userPhone": "9876543210", "type": "daily", "amount": 200,
      "todayStatus": "pending" }
  ],
  "oneTime": [
    { "planId": "...", "userId": "...", "userName": "...", "userPhone": "...",
      "amount": 100000, "durationMonths": 12, "startedAt": "..." }
  ]
}
```

`todayStatus` is `"paid"`, `"missed"`, or `"pending"` (not yet marked
today).

---

## Consumer app - `/api/*`

### Main login (any phone, registered or not)

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/api/auth/send-otp` | - | `{phone}` | Rate-limited (10 / 10 min per IP). Logs the OTP to the server console in demo mode. |
| POST | `/api/auth/verify-otp` | - | `{phone, code}` | In demo mode, `code` must equal the phone's last 4 digits. Sets `gullak_user_token` cookie. Returns `{phone, isRegisteredCustomer}`. |
| POST | `/api/auth/logout` | - | - | Clears the user cookie. |
| GET | `/api/auth/me` | user | - | `{phone, isRegisteredCustomer}` |

### Wallet (second OTP gate, once per session)

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/api/wallet/send-otp` | user | - | Sends the wallet-specific OTP to the logged-in phone. |
| POST | `/api/wallet/verify-otp` | user | `{code}` | On success, re-issues the user cookie with `walletUnlocked: true`. |
| GET | `/api/wallet` | user + unlocked | - | See below. |
| GET | `/api/wallet/receipts/:planId` | user + unlocked | - | `{receipts: [{collected_on, status, amount}]}` for the calendar view (daily plan only). |

**`GET /api/wallet` response shape:**

```json
{
  "hasActivePlans": true,
  "profile": { "name": "Aarti Deshmukh", "accountNumber": "GUL2026...", "phone": "9876543210" },
  "plans": [
    { "type": "daily", "planId": "...", "startedAt": "...", "dailyAmount": 200,
      "investedTillNow": 29600, "daysElapsed": 148, "totalDays": 365,
      "totalReturnAtMaturity": 87600 },
    { "type": "monthly", "planId": "...", "totalAmount": 120000, "tenureMonths": 12,
      "monthlyInstallment": 10000, "installmentsPaid": 5, "totalReturnAtMaturity": 141600 },
    { "type": "fixed", "planId": "...", "startedAt": "...", "amount": 100000,
      "durationMonths": 12, "currentValue": 118750, "principal": 100000, "profitSoFar": 18750 }
  ]
}
```

If the phone isn't linked to a `users` row, `hasActivePlans` is `false`
and `profile`/`plans` are empty - this is the "new user, call admin to
get set up" case from the product spec.

---

## Auth cookies

| Cookie | Role | Set by |
|---|---|---|
| `gullak_admin_token` | admin | `/admin/api/login` |
| `gullak_agent_token` | agent | `/agent/api/login` |
| `gullak_user_token` | user | `/api/auth/verify-otp`, refreshed by `/api/wallet/verify-otp` |

All three are independent - an admin, an agent, and a consumer can be
logged in simultaneously in the same browser without conflict, matching
the three separate frontends.

---

## Error shape

Every error response is `{"error": "human-readable message"}` with an
appropriate HTTP status (`400` bad input, `401` not authenticated, `403`
forbidden, `404` not found, `409` conflict, `500` unexpected).
