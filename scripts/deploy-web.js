const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const rootDir = path.resolve(__dirname, '..');

// Read .env manually without external packages
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const PROJECT_NAME = process.env.CLOUDFLARE_PROJECT_NAME || 'jezsy-app';

console.log('🚀 [1/4] Exporting Expo Web Bundle...');
execSync('npx expo export --platform web', { stdio: 'inherit', cwd: rootDir });

console.log('📦 [2/4] Injecting Cloudflare SPA headers, redirects & worker...');
require('./copy-public-dist.js');

console.log('☁️ [3/4] Deploying to Cloudflare Pages production with --skip-caching...');
const deployCmd = `npx wrangler pages deploy dist --project-name=${PROJECT_NAME} --branch=main --commit-dirty=true --skip-caching`;
execSync(deployCmd, {
  stdio: 'inherit',
  cwd: rootDir,
  env: {
    ...process.env,
    CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID,
  },
});

console.log('✨ [4/4] Purging Cloudflare Pages build cache...');
try {
  const postData = '';
  const options = {
    hostname: 'api.cloudflare.com',
    port: 443,
    path: `/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/purge_build_cache`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('✅ Cloudflare build cache purged successfully!');
      console.log('🎉 Production App Live at: https://jezsy-app.pages.dev');
    });
  });

  req.on('error', (e) => {
    console.warn('⚠️ Cache purge request error (non-fatal):', e.message);
  });

  req.write(postData);
  req.end();
} catch (err) {
  console.warn('⚠️ Cache purge error (non-fatal):', err.message);
}
