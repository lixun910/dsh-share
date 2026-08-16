import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Settings } from './ipc';

const CONFIG_DIR = process.env.DSH_SHARE_CONFIG_DIR || path.join(os.homedir(), '.config', 'dsh-share');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

export const DEFAULTS: Settings = {
  acknowledgedSecurityWarning: false,
  closeToTray: true,
};

function loadSettings(): Settings {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...data };
  } catch (_e) {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: Settings): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

export { loadSettings, saveSettings };
