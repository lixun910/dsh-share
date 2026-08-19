'use strict';
/**
 * electron-builder afterSign hook: notarize the macOS app when Apple
 * credentials are present. Skips silently otherwise (unsigned dev builds).
 */
const { execSync } = require('child_process');
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('Notarization skipped: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // PR builds are not code-signed (electron-builder skips signing for pull
  // requests) and Apple will not notarize an unsigned app — the attempt fails
  // with "code has no resources but signature indicates they must be present".
  // Detect an unsigned app and skip instead of failing the build.
  try {
    execSync(`codesign --verify --deep --strict '${appPath}'`, { stdio: 'ignore' });
  } catch (e) {
    console.log('App is not code-signed (PR build?) — skipping notarization.');
    return;
  }

  console.log(`Notarizing ${appPath} …`);

  await notarize({
    appBundleId: 'dev.dsh.share',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
