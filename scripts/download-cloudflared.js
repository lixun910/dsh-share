'use strict';
/**
 * Download the cloudflared binary for the current platform into ./bin.
 * Runs automatically on `npm install` (postinstall). Safe to re-run.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

function platformKey() {
  const arch = os.arch(); // arm64 | x64
  const plat = process.platform; // darwin | linux | win32
  if (plat === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64';
  if (plat === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-amd64';
  if (plat === 'win32') return 'windows-amd64';
  throw new Error(`Unsupported platform: ${plat}/${arch}`);
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects >= 5) {
            reject(new Error('Too many redirects'));
            res.resume();
            return;
          }
          file.close(() => download(res.headers.location, dest, redirects + 1).then(resolve, reject));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}): ${url}`));
          res.resume();
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

async function main() {
  const key = platformKey();
  const binDir = path.join(__dirname, '..', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Asset naming differs by platform. macOS ships a .tgz (extract it); Linux
  // and Windows ship a plain binary (copy it as-is). Newer cloudflared releases
  // dropped the Linux .tgz, so always use the plain `cloudflared-linux-*` asset.
  const isTgz = process.platform === 'darwin';
  const remoteName = process.platform === 'win32'
    ? 'cloudflared-windows-amd64.exe'
    : process.platform === 'darwin'
      ? `cloudflared-${key}.tgz`
      : `cloudflared-${key}`; // linux: plain binary
  const url = `${BASE}/${remoteName}`;

  const tmp = path.join(os.tmpdir(), `cloudflared-${key}.${isTgz ? 'tgz' : 'bin'}`);
  console.log(`Downloading cloudflared (${key})…`);
  await download(url, tmp);

  const exe = path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (isTgz) {
    console.log('Extracting…');
    execSync(`tar -xzf "${tmp}" -C "${binDir}"`);
    // The tgz contains a single binary named `cloudflared`.
    const extracted = path.join(binDir, 'cloudflared');
    if (fs.existsSync(extracted) && extracted !== exe) fs.renameSync(extracted, exe);
  } else {
    fs.copyFileSync(tmp, exe);
  }
  fs.chmodSync(exe, 0o755);
  fs.unlinkSync(tmp);

  console.log(`cloudflared installed at ${exe}`);
}

main().catch((err) => {
  console.error('cloudflared download failed:', err.message);
  console.error('You can still run the app if cloudflared is on your PATH.');
  process.exit(1);
});
