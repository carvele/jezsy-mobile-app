const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  console.error('[build] dist directory does not exist! Run "npx expo export --platform web" first.');
  process.exit(1);
}

const filesToCopy = ['_headers', '_redirects', '_worker.js'];

filesToCopy.forEach((file) => {
  const src = path.join(publicDir, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[build] Copied ${file} -> dist/${file}`);
  } else {
    console.warn(`[build] Warning: ${file} not found in public/ directory`);
  }
});

// Generate version.json so in-app update checker can detect new deployments
const versionData = {
  buildTime: new Date().toISOString(),
  timestamp: Date.now(),
};

fs.writeFileSync(path.join(distDir, 'version.json'), JSON.stringify(versionData, null, 2));
console.log(`[build] Generated dist/version.json (buildTime: ${versionData.buildTime})`);
