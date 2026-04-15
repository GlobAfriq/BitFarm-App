const fs = require('fs');
const path = require('path');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Convert require to import
  content = content.replace(/(?:const|let|var)\s+([^=]+)\s*=\s*require\((['"])(.*?)\2\);?/g, (match, vars, q, module) => {
    return `import ${vars.trim()} from "${module}";`;
  });

  // 2. Convert exports.foo = ... to export const foo = ...
  content = content.replace(/^exports\.([a-zA-Z0-9_]+)\s*=\s*/gm, 'export const $1 = ');

  // 3. Convert module.exports = { ... } to export { ... }
  content = content.replace(/^module\.exports\s*=\s*\{/gm, 'export {');

  // 4. Add missing JSDoc comments
  // We'll just add a simple JSDoc before functions that don't have one, if needed.
  // Actually, let's just add a generic JSDoc before `export const` or `const` functions if they are exported or top-level.
  
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
