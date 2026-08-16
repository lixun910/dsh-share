#!/usr/bin/env node
'use strict';
/**
 * Update the gh-pages landing page for a new release:
 *   - repoint the three download-button URLs to the new app version, and
 *   - refresh the "Bundled DeepSeek Harness" version note.
 * Idempotent: exits 0 with no change when the page is already current.
 *
 * Usage: node scripts/update-gh-pages.js <app-version> <dsh-version> [index.html path]
 */
const fs = require('fs');

const version = process.argv[2];
const dshVersion = process.argv[3];
const file = process.argv[4] || 'index.html';
if (!version || !dshVersion) {
  console.error('usage: node scripts/update-gh-pages.js <app-version> <dsh-version> [index.html path]');
  process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');
if (html.includes(`releases/download/v${version}/`)) {
  console.log(`Download buttons already at v${version} — nothing to do.`);
  process.exit(0);
}

const before = html;
html = html.replace(
  /releases\/download\/v[^/]+\/dsh-share-[^/]+-arm64\.dmg/,
  `releases/download/v${version}/dsh-share-${version}-arm64.dmg`
);
html = html.replace(
  /releases\/download\/v[^/]+\/dsh-share\.Setup\.[^/]+\.exe/,
  `releases/download/v${version}/dsh-share.Setup.${version}.exe`
);
html = html.replace(
  /releases\/download\/v[^/]+\/dsh-share-[^/]+\.AppImage/,
  `releases/download/v${version}/dsh-share-${version}.AppImage`
);
html = html.replace(
  /(<p class="version-note">Bundled DeepSeek Harness <strong>)v[^<]+(<\/strong>)/,
  `$1v${dshVersion}$2`
);

if (html === before) {
  console.error('No download-button URLs found — nothing to update.');
  process.exit(1);
}
fs.writeFileSync(file, html);
console.log(`Updated download buttons to v${version}, harness v${dshVersion}`);
