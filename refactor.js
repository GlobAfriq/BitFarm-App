const fs = require("fs");
const path = require("path");

function refactorFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");

  // 1. Remove trailing spaces
  content = content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // 2. Convert require to import
  // const { a, b } = require('c'); -> import {a, b} from "c";
  // const a = require('b'); -> import a from "b";
  content = content.replace(
    /(?:const|let|var)\s+([^=]+)\s*=\s*require\((['"])(.*?)\2\);?/g,
    (match, vars, q, module) => {
      let imports = vars.trim();
      // Remove spaces inside curly braces for imports
      if (imports.startsWith("{") && imports.endsWith("}")) {
        imports =
          "{" +
          imports
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .join(",") +
          "}";
      }
      return `import ${imports} from "${module}";`;
    },
  );

  // 3. Replace single quotes with double quotes (except in imports which we already did, but let's do it globally carefully)
  // We'll use a simple regex for strings, but it might break if there are nested quotes.
  // A better way is to use a formatter like prettier or eslint with --fix.
  fs.writeFileSync(filePath, content);
}

const filesToRefactor = [
  "functions/createAdmin.js",
  "functions/index.js",
  "functions/src/admin.js",
  "functions/src/jobs/weeklyPayouts.js",
  "functions/src/machines.js",
  "functions/src/services/badges.js",
  "functions/src/services/fcm.js",
  "functions/src/spin.js",
  "functions/src/streak.js",
  "functions/src/utils/security.js",
  "functions/src/wallet.js",
  "functions/src/webhooks.js",
  "functions/testDb.js",
  "functions/testSignature.js",
  "functions/updateDbId.js",
];

filesToRefactor.forEach(refactorFile);
console.log("Done basic refactor");
