import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from './ipc';

export interface Updater {
  check(): Promise<unknown>;
  install(): void;
}

/**
 * Wire up electron-updater. Returns null in dev (`npm start`), where the app
 * is not packaged — electron-updater would try to hit the update server and
 * fail. In a packaged build it checks GitHub releases on launch, downloads the
 * new version in the background, and installs on quit (or immediately via the
 * "Restart & install" button in the control window).
 */
export function initUpdater(send: (status: UpdateStatus) => void): Updater | null {
  if (!app.isPackaged) return null;

  autoUpdater.autoDownload = true;
  // Safety net: even if the user never clicks "Restart & install", the update
  // installs the next time the app quits.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  );
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err.message }));

  return {
    check: () => autoUpdater.checkForUpdates(),
    install: () => autoUpdater.quitAndInstall(),
  };
}
