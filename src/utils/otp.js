const db = require('../db/client');
const env = require('../config/env');

const OTP_TTL_MINUTES = 5;

// Demo-mode "OTP": the last 4 digits of the phone number itself, so
// anyone testing the app can log in without a real SMS. This is the
// ONE place that changes when a real SMS provider gets wired up later
// - see the TODO in sendOtp() and the else-branch in verifyOtp().
function lastFourDigits(phone) {
  return String(phone).slice(-4);
}

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
}

// Creates and "sends" an OTP for a phone number + purpose ('login' or
// 'wallet'). In demo mode there's no real SMS provider wired up, so the
// code is just the phone's last 4 digits (logged to the console too, so
// it's visible without reading the frontend). Swap this for a real
// provider call (Twilio, MSG91, etc.) when DEMO_OTP_MODE=false.
async function sendOtp(phone, purpose) {
  const code = env.demoOtpMode ? lastFourDigits(phone) : generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await db.execute({
    sql: 'INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, ?, ?)',
    args: [phone, code, purpose, expiresAt]
  });

  if (env.demoOtpMode) {
    console.log(`[DEMO OTP] phone=${phone} purpose=${purpose} code=${code} (last 4 digits of the phone number)`);
  } else {
    // TODO: call a real SMS provider here before disabling demo mode.
    console.log(`[OTP] Sending ${code} to ${phone} via SMS provider (not yet configured)`);
  }

  return { sent: true };
}

// Verifies a submitted code for a phone + purpose.
// Demo mode: code must equal the phone's last 4 digits.
// Real mode: must match an unconsumed, unexpired code exactly.
async function verifyOtp(phone, submittedCode, purpose) {
  if (env.demoOtpMode) {
    return String(submittedCode || '') === lastFourDigits(phone);
  }

  const result = await db.execute({
    sql: `SELECT id, expires_at FROM otp_codes
          WHERE phone = ? AND purpose = ? AND code = ? AND consumed = 0
          ORDER BY id DESC LIMIT 1`,
    args: [phone, purpose, String(submittedCode)]
  });

  const row = result.rows[0];
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;

  await db.execute({
    sql: 'UPDATE otp_codes SET consumed = 1 WHERE id = ?',
    args: [row.id]
  });

  return true;
}

module.exports = { sendOtp, verifyOtp };
