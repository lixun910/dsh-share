import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Auth } from './ipc';

const CONFIG_DIR = process.env.DSH_SHARE_CONFIG_DIR || path.join(os.homedir(), '.config', 'dsh-share');
const CONFIG_FILE = path.join(CONFIG_DIR, 'auth.json');

function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

function saveAuth(auth: Auth): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

function loadAuth(): Auth {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (data && data.username && data.password) {
      return { username: data.username, password: data.password };
    }
  } catch (_e) {
    // fall through to create a fresh one
  }
  const auth = { username: 'dsh', password: generatePassword() };
  saveAuth(auth);
  return auth;
}

function regenerateAuth(): Auth {
  const auth = { username: 'dsh', password: generatePassword() };
  saveAuth(auth);
  return auth;
}

export { loadAuth, regenerateAuth, generatePassword };
