const jwt = require('jsonwebtoken');
const env = require('../config/env');

// role: 'admin' | 'agent' | 'user'
// payload: whatever else you want stored (id, phone, email, etc.)
function signToken(role, payload, expiresIn) {
  return jwt.sign({ role, ...payload }, env.jwtSecret, {
    expiresIn: expiresIn || '7d'
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
