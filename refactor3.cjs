const fs = require('fs');
const path = require('path');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Add .js to local imports
  content = content.replace(/from\s+"(\.[^"]+)"/g, (match, p1) => {
    if (!p1.endsWith('.js')) {
      return `from "${p1}.js"`;
    }
    return match;
  });

  fs.writeFileSync(filePath, content);
  console.log(`Processed ${filePath}`);
}

const files = [
  'functions/createAdmin.js',
  'functions/index.js',
  'functions/src/admin.js',
  'functions/src/jobs/weeklyPayouts.js',
  'functions/src/machines.js',
  'functions/src/services/badges.js',
  'functions/src/services/fcm.js',
  'functions/src/spin.js',
  'functions/src/streak.js',
  'functions/src/utils/security.js',
  'functions/src/wallet.js',
  'functions/src/webhooks.js',
  'functions/testDb.js',
  'functions/testSignature.js',
  'functions/updateDbId.js'
];

files.forEach(processFile);
