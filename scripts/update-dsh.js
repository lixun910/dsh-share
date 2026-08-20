#!/usr/bin/env node
'use strict';
/**
 * Daily dsh-share updater.
 *
 * 1. Reads the latest @deepseek-ai/dsh version from npm.
 * 2. If it differs from the pinned version, bumps every @deepseek-ai/dsh-*
 *    dependency to the new version (the dsh-* family releases in lockstep
 *    with @deepseek-ai/dsh) and bumps the app's own version to the next patch
 *    after the latest v* tag. Other @deepseek-ai/* packages (cordis and
 *    friends) live on their own version lines and are left alone.
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

// 2. Bump every @deepseek-ai/dsh-* dep to the new dsh version. The dsh-*
//    family releases in lockstep with @deepseek-ai/dsh, but other
//    @deepseek-ai/* packages (cordis, cordis-plugin-*, cosmokit, schemastery,
//    node-addon-landlock-run) live on their own version lines and must be left
//    alone — a blanket bump applied dsh's version to cordis (real line: 4.x)
//    and broke `npm install` with ERESOLVE.
//
//    Guard against a partially-published upstream release: check the new
//    version actually exists for every dsh-* package before writing anything.
//    If one lags, back out cleanly — the next daily run will pick it up.
//    Note: @deepseek-ai/dsh itself (no trailing hyphen) is part of the family.
const isDshFamily = (name) =>
  name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');

const bumped = [];
for (const name of Object.keys(pkg.dependencies)) {
  if (!isDshFamily(name)) continue;
  let exists;
  try {
    exists = sh(`npm view ${name}@${latest} version`);
  } catch (e) {
    exists = '';
  }
  if (exists !== latest) {
    console.error(
      `@deepseek-ai/dsh@${latest} is published but ${name} is not yet at that ` +
        `version — skipping this run so we don't pin a package that doesn't exist.`
    );
    process.exit(0);
  }
  pkg.dependencies[name] = `^${latest}`;
  bumped.push(name);
}
console.log(`bumping ${bumped.length} dsh-* packages to ^${latest}`);

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
//    Skip optional entries (e.g. @deepseek-ai/node-addon-landlock-run-linux-*):
//    those are platform-specific sub-dependencies, not harness packages, and
//    pinning them as required deps would break installs on every other
//    platform (EBADPLATFORM).
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const added = [];
for (const key of Object.keys(lock.packages || {})) {
  const m = key.match(/^node_modules\/(@deepseek-ai\/[^/]+)$/);
  if (!m) continue;
  const name = m[1];
  if (pkg.dependencies[name] || lock.packages[key].optional) continue;
  pkg.dependencies[name] = `^${lock.packages[key].version}`;
  added.push(`${name}@${lock.packages[key].version}`);
}
if (added.length) {
  console.log(`adding new harness packages: ${added.join(', ')}`);
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  sh('npm install');
}

console.log('done.');
