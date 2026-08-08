const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
  console.error("Please provide the new version as an argument.");
  process.exit(1);
}

// 1. Update app.json
const appJsonPath = path.resolve(__dirname, '../app.json');
if (fs.existsSync(appJsonPath)) {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.version = newVersion;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8');
  console.log(`✓ Updated app.json to version ${newVersion}`);
} else {
  console.error("app.json not found!");
}

// 2. Update executas/shipghost/executa.json
const executaJsonPath = path.resolve(__dirname, '../executas/shipghost/executa.json');
if (fs.existsSync(executaJsonPath)) {
  const executaJson = JSON.parse(fs.readFileSync(executaJsonPath, 'utf8'));
  const oldVersion = executaJson.version;
  executaJson.version = newVersion;
  
  // Replace version in binary URLs
  if (executaJson.distribution && executaJson.distribution.profiles && executaJson.distribution.profiles.binary) {
    const urls = executaJson.distribution.profiles.binary.binary_urls;
    for (const key in urls) {
      if (urls[key].url) {
        // Safe replace targeting the /v1.2.4/ pattern
        const versionPattern = new RegExp(`/v${oldVersion.replace(/\./g, '\\.')}/`, 'g');
        urls[key].url = urls[key].url.replace(versionPattern, `/v${newVersion}/`);
      }
    }
  }
  
  fs.writeFileSync(executaJsonPath, JSON.stringify(executaJson, null, 2) + '\n', 'utf8');
  console.log(`✓ Updated executas/shipghost/executa.json to version ${newVersion}`);
} else {
  console.error("executa.json not found!");
}
