const fs = require('fs');
const path = require('path');

const dbId = 'ai-studio-7c48d254-792c-4a9f-aed6-50d6c4dc3791';

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('getFirestore()')) {
    content = content.replace(/getFirestore\(\)/g, `getFirestore('${dbId}')`);
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      replaceInFile(fullPath);
    }
  }
}

walkDir(path.join(__dirname, 'src'));
