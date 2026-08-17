import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { execFile, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import * as http from 'http';
import * as path from 'path';
import { startTunnel, stopTunnel, type TunnelHandle } from './cloudflared';
import { createAuthProxy, stopProxy, getFreePort, waitForPort, isPortInUse } from './proxy';
import { startDsh, stopDsh } from './dsh';
import { loadAuth, regenerateAuth } from './auth';
import { loadSettings, saveSettings } from './settings';
import { initUpdater } from './updater';
import type { Auth, SessionState, SessionStatus, Settings, StatusMessage, UpdateStatus } from './ipc';

const DSH_PORT = 3080;

let mainWindow: BrowserWindow | null = null;
let tunnel: TunnelHandle | null = null;
let dsh: ChildProcess | null = null;
let proxy: http.Server | null = null;
let dshPort: number = DSH_PORT; // the port the app's own dsh instance is on
let auth: Auth = loadAuth();
// The credentials the live proxy uses. Regenerating `auth` mid-tunnel does
// not affect a running proxy, so the QR must always encode these — never
// the possibly-newer `auth`. Set once per successful proxy start.
let runningAuth: Auth | null = null;
// Per-session bootstrap token embedded in the QR's public URL. The dsh-mobile
// app scans the plain link, then exchanges this token for the live credentials
// via the /~dsh-share/session endpoint (the token only unlocks that endpoint,
// never the tunnel itself). Regenerated on every start.
let bootstrapToken: string | null = null;
let settings: Settings = loadSettings();
// Explicit session state for the /~dsh-share/session endpoint. Kept in step
// with the status messages sent to the renderer.
let sessionState: SessionState = 'stopped';
let startedAt: number | null = null;
let tray: Tray | null = null;
let isQuitting = false;
// Auto-update (electron-updater). Null in dev — the app isn't packaged, so
// there's no update server to hit and no signed app to replace.
const updater = initUpdater((status) => send('update', status));

function send(channel: 'status', data: StatusMessage): void;
function send(channel: 'log', data: string): void;
function send(channel: 'update', data: UpdateStatus): void;
function send(channel: 'status' | 'log' | 'update', data: StatusMessage | string | UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
  if (channel === 'status') updateTray();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 680,
    title: 'dsh-share',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Replay the current state into a freshly loaded window (reload, or the
  // window being recreated while the tunnel keeps running). Without this the
  // renderer would show "stopped" and the mobile card would never appear
  // until a full restart.
  mainWindow.webContents.on('did-finish-load', () => {
    if (tunnel || dsh) {
      send('status', {
        state: 'running',
        url: tunnel && tunnel.publicUrl,
        auth: runningAuth,
        bootstrapToken,
      });
    }
  });
  // Close-to-tray: hide the window and keep the share alive instead of
  // destroying the session. Quit from the tray (or Cmd+Q) is the real exit.
  mainWindow.on('close', (e) => {
    if (settings.closeToTray && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

/**
 * Build the dsh:// connection URI the QR and the status endpoint both encode.
 * Mirrors renderer/renderer.js buildConnectionUri().
 */
function buildConnectionUri(publicUrl: string, auth: Auth): string {
  const host = new URL(publicUrl).host;
  return (
    'dsh://' +
    host +
    '?v=1&u=' +
    encodeURIComponent(auth.username) +
    '&p=' +
    encodeURIComponent(auth.password)
  );
}

/**
 * Build the plain public URL the QR encodes. A normal phone camera scanning
 * this sees a real https link (not a dsh:// string), while the dsh-mobile app
 * recognizes the `dsh_share` token and exchanges it for the live credentials
 * via the /~dsh-share/session endpoint. Mirrors renderer/renderer.js
 * buildQrUrl().
 */
function buildQrUrl(publicUrl: string, token: string): string {
  const host = new URL(publicUrl).host;
  return 'https://' + host + '/?dsh_share=' + encodeURIComponent(token);
}

/** Live status served at /~dsh-share/session (see proxy.ts SESSION_PATH). */
function getStatus(): SessionStatus | null {
  const url = tunnel ? tunnel.publicUrl : null;
  return {
    app: 'dsh-share',
    version: app.getVersion(),
    session: {
      state: sessionState,
      publicUrl: url,
      host: url ? new URL(url).host : null,
      dshPort: runningAuth ? dshPort : null,
      startedAt,
    },
    connection:
      runningAuth && url
        ? {
            uri: buildConnectionUri(url, runningAuth),
            username: runningAuth.username,
            password: runningAuth.password,
          }
        : null,
  };
}

function trayIconPath(): string {
  // macOS wants a template image (black + alpha) so it adapts to the menu bar;
  // Windows/Linux want a colored icon.
  return process.platform === 'darwin'
    ? path.join(__dirname, '..', 'build', 'trayTemplate.png')
    : path.join(__dirname, '..', 'build', 'tray.png');
}

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/** (Re)build the tray icon, tooltip and menu from the current session state. */
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const url = tunnel ? tunnel.publicUrl : null;
  tray.setToolTip(url ? `dsh-share — ${url}` : 'dsh-share — idle');
  const running = !!tunnel;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show dsh-share', click: () => showMainWindow() },
      {
        label: url ? `Open ${url}` : 'Open public URL',
        enabled: !!url,
        click: () => url && shell.openExternal(url),
      },
      { type: 'separator' },
      {
        // Starting from the tray must respect the first-run security gate the
        // renderer enforces, so it's disabled until the warning is acknowledged.
        label: running ? 'Stop sharing' : 'Start sharing',
        enabled: running || settings.acknowledgedSecurityWarning,
        click: () => (running ? stop() : start()),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(trayIconPath()));
  // Windows/Linux: left-click brings the window back (the context menu opens on
  // right-click). On macOS the menu opens on click, so this is a no-op there.
  tray.on('click', () => {
    if (process.platform !== 'darwin') showMainWindow();
  });
  updateTray();
}

async function start() {
  if (tunnel || dsh) {
    send('status', { state: 'running', url: tunnel && tunnel.publicUrl, auth: runningAuth });
    return;
  }
  // The app's dsh shares ~/.dsh with any dsh the user already has running.
  // A dsh on the default port 3080 is the tell — warn before starting so the
  // two don't fight over the profile (which surfaces as EPERM / 502).
  if (await isPortInUse(DSH_PORT)) {
    send('status', {
      state: 'error',
      message: `A dsh instance is already running on port ${DSH_PORT}. Stop it first, then click Start again.`,
    });
    return;
  }
  sessionState = 'starting';
  startedAt = Date.now();
  send('status', { state: 'starting', message: 'Starting tunnel…' });
  try {
    // Pick a free port for the app's own dsh instance so it never collides
    // with a dsh the user may already have running on 3080.
    dshPort = await getFreePort();
    const proxyPort = await getFreePort();

    // 1. Local basic-auth proxy in front of dsh (Cloudflare quick tunnels
    //    don't provide auth themselves).
    //    Capture the credentials the proxy actually uses — regenerating auth
    //    mid-tunnel doesn't affect a live proxy, so the QR must encode these.
    const proxyAuth = { username: auth.username, password: auth.password };
    runningAuth = proxyAuth;
    // Fresh bootstrap token for this session, embedded in the QR's public URL.
    bootstrapToken = randomBytes(24).toString('hex');
    proxy = await createAuthProxy({
      listenPort: proxyPort,
      targetPort: dshPort,
      username: proxyAuth.username,
      password: proxyAuth.password,
      bootstrapToken,
      onLog: (line) => send('log', line),
      getStatus,
    });

    // 2. Cloudflare quick tunnel to the proxy — no account or token needed.
    tunnel = await startTunnel(proxyPort, (line) => send('log', line));
    const host = new URL(tunnel.publicUrl).host;
    send('log', `Tunnel up: ${tunnel.publicUrl}\n`);
    sessionState = 'tunnel-up';
    send('status', {
      state: 'tunnel-up',
      url: tunnel.publicUrl,
      host,
      dshPort,
      auth: proxyAuth,
      bootstrapToken,
    });

    // 3. Start dsh with the public host trusted, on the free port.
    let dshLog = '';
    dsh = startDsh(host, dshPort, (line) => {
      dshLog += line;
      send('log', line);
    });

    // 4. Wait for dsh to actually bind before reporting "running" — otherwise
    //    the tunnel is up but the origin 502s and the user sees no reason.
    const up = await waitForPort(dshPort, 20000);
    if (!up) {
      sessionState = 'error';
      send('status', {
        state: 'error',
        message: 'dsh did not start. See the log for details.',
      });
      send('log', '\n[dsh failed to start] — last output:\n' + dshLog.slice(-2000) + '\n');
      return;
    }
    sessionState = 'running';
    send('status', {
      state: 'running',
      url: tunnel.publicUrl,
      host,
      dshPort,
      auth: proxyAuth,
      bootstrapToken,
    });
  } catch (err) {
    sessionState = 'error';
    send('status', { state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function stop() {
  if (dsh) {
    stopDsh(dsh);
    dsh = null;
  }
  if (tunnel) {
    stopTunnel(tunnel);
    tunnel = null;
  }
  if (proxy) {
    stopProxy(proxy);
    proxy = null;
  }
  runningAuth = null;
  bootstrapToken = null;
  sessionState = 'stopped';
  startedAt = null;
  send('status', { state: 'stopped' });
}

/**
 * Kill whatever process is listening on `port` (used to stop a dsh the user
 * already has running on 3080). Returns true if at least one process was
 * killed.
 */
function killProcessOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('netstat', ['-ano'], (err, stdout) => {
        if (err) return resolve(false);
        const pids = new Set<string>();
        for (const line of stdout.split('\n')) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid)) pids.add(pid);
          }
        }
        if (pids.size === 0) return resolve(false);
        let remaining = pids.size;
        let killed = false;
        for (const pid of pids) {
          execFile('taskkill', ['/PID', pid, '/F'], () => {
            killed = true;
            if (--remaining === 0) resolve(killed);
          });
        }
      });
    } else {
      execFile('lsof', ['-ti', `:${port}`], (err, stdout) => {
        if (err) return resolve(false);
        const pids = stdout.trim().split('\n').filter(Boolean);
        if (pids.length === 0) return resolve(false);
        let remaining = pids.length;
        let killed = false;
        for (const pid of pids) {
          execFile('kill', [pid], () => {
            killed = true;
            if (--remaining === 0) resolve(killed);
          });
        }
      });
    }
  });
}

// --- IPC ---
ipcMain.handle('start', () => start());
ipcMain.handle('stop', () => stop());
ipcMain.handle('get-auth', () => auth);
ipcMain.handle('regenerate-auth', () => {
  auth = regenerateAuth();
  return auth;
});
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  return settings;
});
ipcMain.handle('open-local', () => {
  shell.openExternal(`http://localhost:${dshPort}`);
});
ipcMain.handle('open-url', (_e, url: string) => shell.openExternal(url));
ipcMain.handle('check-dsh-conflict', () => isPortInUse(DSH_PORT));
ipcMain.handle('stop-dsh-on-port', () => killProcessOnPort(DSH_PORT));
ipcMain.handle('update-check', () => updater?.check());
ipcMain.handle('update-install', () => updater?.install());

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Check for updates shortly after launch (packaged builds only). Errors are
  // swallowed — an offline machine or a transient GitHub hiccup shouldn't
  // bother the user; the check just runs again on the next launch.
  if (updater) {
    setTimeout(() => updater.check().catch(() => {}), 5000);
  }
  app.on('activate', () => {
    // Dock click (macOS): show the hidden close-to-tray window, or recreate it
    // if it was genuinely closed.
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  // With close-to-tray the window is hidden rather than destroyed, so this
  // only fires after a real close — restore the old stop-and-quit behavior
  // there. When keep-sharing is on, the app lives on in the tray.
  if (!settings.closeToTray) {
    stop();
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stop();
});
