// There's no admin table to seed - the single admin account is defined
// entirely by ADMIN_EMAIL / ADMIN_PASSWORD in .env (see src/config/env.js,
// which already exits with an error if either is missing). This script
// just prints a confirmation so `npm run seed:check` gives visible
// feedback after setup, instead of silently doing nothing.
const env = require('../config/env');

console.log('Admin login is configured:');
console.log('  email: ' + env.adminEmail);
console.log('  password: (set, ' + env.adminPassword.length + ' characters)');
console.log('\nLog in at /admin with these credentials, then use the admin');
console.log('panel to create your first agent and user for testing.');
