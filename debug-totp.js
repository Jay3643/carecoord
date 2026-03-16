// debug-totp.js
const {initDb, getDb} = require('./server/database');

let speakeasy;
try {
  speakeasy = require('speakeasy');
  console.log('✓ speakeasy loaded');
} catch(e) {
  console.log('✗ speakeasy NOT FOUND - trying server path...');
  try {
    speakeasy = require('./server/node_modules/speakeasy');
    console.log('✓ speakeasy loaded from server/node_modules');
  } catch(e2) {
    console.log('✗ speakeasy NOT FOUND anywhere!');
    console.log('Run: npm install speakeasy');
    process.exit(1);
  }
}

initDb().then(() => {
  const db = getDb();
  
  // Check if any user has a totp_secret
  const users = db.prepare('SELECT id, email, totp_secret, totp_enabled FROM users').all();
  console.log('\nUsers with TOTP:');
  users.forEach(u => {
    console.log('  ' + u.email + ' | secret: ' + (u.totp_secret || 'NULL') + ' | enabled: ' + u.totp_enabled);
  });

  // Generate a test secret and code right now
  console.log('\n--- Testing TOTP locally ---');
  const secret = speakeasy.generateSecret({ name: 'Test' });
  console.log('Generated secret: ' + secret.base32);
  
  const token = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
  console.log('Generated token: ' + token);
  
  const verified = speakeasy.totp.verify({ secret: secret.base32, encoding: 'base32', token: token, window: 2 });
  console.log('Self-verify: ' + verified);

  // If a user has a secret, generate what their current code should be
  const userWithSecret = users.find(u => u.totp_secret);
  if (userWithSecret) {
    const secretVal = typeof userWithSecret.totp_secret === 'object' 
      ? Buffer.from(userWithSecret.totp_secret).toString() 
      : userWithSecret.totp_secret;
    console.log('\nSecret type: ' + typeof userWithSecret.totp_secret);
    console.log('Secret raw value: ' + JSON.stringify(userWithSecret.totp_secret));
    console.log('Secret as string: ' + secretVal);
    
    const currentCode = speakeasy.totp({ secret: secretVal, encoding: 'base32' });
    console.log('Current valid code for ' + userWithSecret.email + ': ' + currentCode);
    
    const v = speakeasy.totp.verify({ secret: secretVal, encoding: 'base32', token: currentCode, window: 2 });
    console.log('Verify that code: ' + v);
  }
});
