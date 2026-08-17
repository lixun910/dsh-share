'use strict';

const api = window.dshShare;

const $ = (id) => document.getElementById(id);

const statusDot = $('status-dot');
const statusText = $('status-text');
const statusMessage = $('status-message');
const urlInput = $('url');
const copyBtn = $('copy-btn');
const mobileCard = $('mobile-card');
const qrEl = $('qr');
const copyUriBtn = $('copy-uri-btn');
const usernameInput = $('username');
const passwordInput = $('password');
const regenerateBtn = $('regenerate-btn');
const openLocalBtn = $('open-local-btn');
const dshPortEl = $('dsh-port');
const startBtn = $('start-btn');
const stopBtn = $('stop-btn');
const logEl = $('log');
const closeToTrayEl = $('close-to-tray');
const warningOverlay = $('warning-overlay');
const ackWarningBtn = $('ack-warning-btn');
const conflictOverlay = $('conflict-overlay');
const conflictRetryBtn = $('conflict-retry-btn');
const conflictStopBtn = $('conflict-stop-btn');
const updateCard = $('update-card');
const updateText = $('update-text');
const updateInstallBtn = $('update-install-btn');

let currentUrl = '';
let currentAuth = null;
let currentToken = '';
let settings = { acknowledgedSecurityWarning: false };
let warningAcknowledged = false;

// Build the dsh:// connection URI the "Copy connection URI" button copies. The
// auth comes from the status payload — the credentials the running proxy
// actually uses (a regenerated password doesn't affect a live tunnel).
function buildConnectionUri(url, auth) {
  if (!url || !auth) return null;
  const host = new URL(url).host;
  return (
    'dsh://' +
    host +
    '?v=1&u=' +
    encodeURIComponent(auth.username) +
    '&p=' +
    encodeURIComponent(auth.password)
  );
}

// Build the plain public URL the QR encodes. A normal phone camera scanning
// this sees a real https link (not a dsh:// string), while the dsh-mobile app
// recognizes the `dsh_share` token and exchanges it for the live credentials
// via the /~dsh-share/session endpoint.
function buildQrUrl(url, token) {
  if (!url || !token) return null;
  const host = new URL(url).host;
  return 'https://' + host + '/?dsh_share=' + encodeURIComponent(token);
}

function renderQr(uri) {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4 });
}

function setStatus(state, message) {
  statusDot.className = 'dot';
  if (state === 'running') {
    statusDot.classList.add('running');
    statusText.textContent = 'Running';
  } else if (state === 'starting' || state === 'tunnel-up') {
    statusDot.classList.add('starting');
    statusText.textContent = state === 'tunnel-up' ? 'Tunnel up — starting dsh…' : 'Starting…';
  } else if (state === 'error') {
    statusDot.classList.add('error');
    statusText.textContent = 'Error';
  } else {
    statusText.textContent = 'Idle';
  }
  statusMessage.textContent = message || '';
}

function appendLog(line) {
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(running) {
  startBtn.disabled = running || !warningAcknowledged;
  stopBtn.disabled = !running;
  copyBtn.disabled = !currentUrl;
}

api.onStatus((s) => {
  setStatus(s.state, s.message);
  if (s.url) {
    currentUrl = s.url;
    urlInput.value = s.url;
  }
  if (s.auth) {
    currentAuth = s.auth;
  }
  if (s.bootstrapToken) {
    currentToken = s.bootstrapToken;
  }
  if (s.dshPort) {
    dshPortEl.textContent = `localhost:${s.dshPort}`;
  }
  const running = s.state === 'running' || s.state === 'tunnel-up';
  if (running) {
    const uri = buildQrUrl(currentUrl, currentToken);
    if (uri) {
      renderQr(uri);
      mobileCard.classList.remove('hidden');
    }
  } else {
    mobileCard.classList.add('hidden');
  }
  setRunning(running);
});

api.onLog((line) => appendLog(line));

// Auto-update. With auto-download on, `available` is transient — the download
// starts immediately and `downloading` follows. `checking` / `not-available` /
// `error` hide the card: a failed check (offline, etc.) is not worth bothering
// the user about — it just runs again on the next launch.
api.onUpdate((s) => {
  if (s.state === 'available' || s.state === 'downloading') {
    updateCard.classList.remove('hidden');
    updateText.textContent =
      s.state === 'available'
        ? `Downloading v${s.version}…`
        : `Downloading v${s.version}… ${s.percent}%`;
    updateInstallBtn.classList.add('hidden');
  } else if (s.state === 'downloaded') {
    updateCard.classList.remove('hidden');
    updateText.textContent = `v${s.version} is ready. Restart to install.`;
    updateInstallBtn.classList.remove('hidden');
  } else {
    updateCard.classList.add('hidden');
  }
});

updateInstallBtn.addEventListener('click', () => api.installUpdate());

async function startWithConflictCheck() {
  const conflict = await api.checkDshConflict();
  if (conflict) {
    conflictOverlay.classList.remove('hidden');
    return;
  }
  api.start();
}

startBtn.addEventListener('click', () => {
  appendLog('Starting…\n');
  startWithConflictCheck();
});

conflictRetryBtn.addEventListener('click', async () => {
  const conflict = await api.checkDshConflict();
  if (conflict) {
    appendLog('A dsh instance is still running on port 3080. Stop it first.\n');
    return;
  }
  conflictOverlay.classList.add('hidden');
  appendLog('Starting…\n');
  api.start();
});

conflictStopBtn.addEventListener('click', async () => {
  conflictStopBtn.disabled = true;
  conflictStopBtn.textContent = 'Stopping…';
  appendLog('Stopping the dsh on port 3080…\n');
  await api.stopDshOnPort();
  // Give the process a moment to release the port, then re-check.
  await new Promise((r) => setTimeout(r, 800));
  const conflict = await api.checkDshConflict();
  conflictStopBtn.disabled = false;
  conflictStopBtn.textContent = 'Stop it for me';
  if (conflict) {
    appendLog('Could not stop it — the port is still in use. Stop it manually.\n');
    return;
  }
  conflictOverlay.classList.add('hidden');
  appendLog('Stopped. Starting…\n');
  api.start();
});

stopBtn.addEventListener('click', () => {
  appendLog('Stopping…\n');
  api.stop();
});

copyBtn.addEventListener('click', async () => {
  if (!currentUrl) return;
  try {
    await navigator.clipboard.writeText(currentUrl);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
  } catch (_e) {
    /* clipboard unavailable */
  }
});

copyUriBtn.addEventListener('click', async () => {
  const uri = buildConnectionUri(currentUrl, currentAuth);
  if (!uri) return;
  try {
    await navigator.clipboard.writeText(uri);
    copyUriBtn.textContent = 'Copied!';
    setTimeout(() => (copyUriBtn.textContent = 'Copy connection URI'), 1200);
  } catch (_e) {
    /* clipboard unavailable */
  }
});

regenerateBtn.addEventListener('click', async () => {
  const auth = await api.regenerateAuth();
  passwordInput.value = auth.password;
  appendLog('Credentials regenerated. Restart the tunnel for it to take effect.\n');
});

openLocalBtn.addEventListener('click', () => api.openLocal());

ackWarningBtn.addEventListener('click', async () => {
  settings = await api.saveSettings({ acknowledgedSecurityWarning: true });
  warningAcknowledged = true;
  warningOverlay.classList.add('hidden');
  setRunning(false);
});

// Keep-sharing-on-close is a live preference — no restart needed, the main
// process consults settings.closeToTray on every window-close event.
closeToTrayEl.addEventListener('change', async () => {
  settings = await api.saveSettings({ closeToTray: closeToTrayEl.checked });
});

// Load credentials + settings
api.getAuth().then((auth) => {
  usernameInput.value = auth.username;
  passwordInput.value = auth.password;
});
api.getSettings().then((s) => {
  settings = s;
  closeToTrayEl.checked = !!s.closeToTray;
  warningAcknowledged = !!s.acknowledgedSecurityWarning;
  if (!warningAcknowledged) {
    warningOverlay.classList.remove('hidden');
  }
  setRunning(false);
});
