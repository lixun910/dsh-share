#!/usr/bin/env node
'use strict';
/**
 * Daily dsh-share updater.
 *
 * 1. Reads the latest @deepseek-ai/dsh version from npm.
 * 2. If it differs from the pinned version, bumps every @deepseek-ai/*
 *    dependency to the new version and bumps the app's own version to the
 *    next patch after the latest v* tag.
 * 3. Reinstalls, then scans the lockfile for any @deepseek-ai/* package not
 *    yet declared as a direct dependency and adds it. electron-builder drops
 *    peerDependencies, so every harness package must be a direct dep to hoist
 *    to the top level (see commit 345d470).
 * 4. Exits 0 with no changes when already up to date.
 *
 * Run from the repo root. Requires a git checkout with tags (fetch-depth: 0).
 */
const { execSync } = require('child_process');
const fs = require('fs');

const PKG = 'package.json';
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function latestTag() {
  const tags = sh('git tag --sort=-v:refname').split('\n');
  return tags.find((t) => /^v\d+\.\d+\.\d+/.test(t)) || null;
}

// 1. Latest @deepseek-ai/dsh on npm.
let latest;
try {
  latest = sh('npm view @deepseek-ai/dsh version');
} catch (e) {
  // Transient network failure — don't fail the daily job over it.
  console.error(`Could not query npm for @deepseek-ai/dsh: ${e.message}`);
  process.exit(0);
}
const current = (pkg.dependencies['@deepseek-ai/dsh'] || '').replace(/^\^/, '');
if (latest === current) {
  console.log(`@deepseek-ai/dsh already at ${latest} — nothing to do.`);
  process.exit(0);
}
console.log(`@deepseek-ai/dsh ${current} → ${latest}`);

// 2. Bump every @deepseek-ai/* dep to the new version.
for (const name of Object.keys(pkg.dependencies)) {
  if (name.startsWith('@deepseek-ai/')) {
    pkg.dependencies[name] = `^${latest}`;
  }
}

// 3. Bump the app version to the next patch after the latest v* tag, but never
//    downgrade a version that was bumped manually.
const tag = latestTag();
if (tag) {
  const [maj, min, pat] = tag.replace(/^v/, '').split('.').map(Number);
  const next = `${maj}.${min}.${pat + 1}`;
  const cmp = (a, b) => {
    const [am, ai, ap] = a.split('.').map(Number);
    const [bm, bi, bp] = b.split('.').map(Number);
    return am - bm || ai - bi || ap - bp;
  };
  if (cmp(next, pkg.version) > 0) {
    pkg.version = next;
    console.log(`app version → ${pkg.version}`);
  }
}

fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
sh('npm install');

// 4. Add any @deepseek-ai/* package in the lockfile that isn't a direct dep.
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const added = [];
for (const key of Object.keys(lock.packages || {})) {
  const m = key.match(/^node_modules\/(@deepseek-ai\/[^/]+)$/);
  if (!m) continue;
  const name = m[1];
  if (!pkg.dependencies[name]) {
    pkg.dependencies[name] = `^${lock.packages[key].version}`;
    added.push(`${name}@${lock.packages[key].version}`);
  }
}
if (added.length) {
  console.log(`adding new harness packages: ${added.join(', ')}`);
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  sh('npm install');
}

console.log('done.');
