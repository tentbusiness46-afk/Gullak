const { customAlphabet } = require('nanoid');

// Lowercase alphanumeric, no ambiguous characters - fine for internal
// primary keys (agents, users, plans, collections).
const genId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

// Account numbers shown to the user: GUL + year + 8 random digits.
// e.g. GUL2026 48203951
const genAccountNumber = customAlphabet('0123456789', 8);
function generateAccountNumber() {
  const year = new Date().getFullYear();
  return `GUL${year}${genAccountNumber()}`;
}

module.exports = { genId, generateAccountNumber };
