import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export interface TunnelHandle {
  proc: ChildProcess;
  publicUrl: string;
}

/**
 * Resolve the cloudflared binary: prefer the bundled one (packaged app or
 * ./bin), then PATH.
 */
function resolveCloudflaredBin(): string {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
  }
  candidates.push(path.join(__dirname, '..', 'bin', exe));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.env.CLOUDFLARED_BIN || 'cloudflared';
}

/**
 * Start a Cloudflare quick tunnel to `port`. No account or token required.
 */
function startTunnel(port: number, onLog?: (line: string) => void): Promise<TunnelHandle> {
  const bin = resolveCloudflaredBin();
  const args = [
    'tunnel',
    '--url', `http://127.0.0.1:${port}`,
    '--no-autoupdate',
    '--logfile', '-',
  ];
  const proc = spawn(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // cloudflared's `--logfile -` also drops a stray file named `-` in the
    // cwd; run it from a temp dir so that never lands in the app folder.
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-share-cf-')),
  });

  let url = '';
  const onData = (d: Buffer) => {
    const s = d.toString();
    onLog && onLog(s);
    if (!url) {
      const m = s.match(URL_RE);
      if (m) url = m[0];
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (err) => onLog && onLog(`cloudflared error: ${err.message}\n`));

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (url) {
        clearInterval(timer);
        resolve({ proc, publicUrl: url });
      } else if (Date.now() - start > 30000) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for the Cloudflare tunnel URL'));
      }
    }, 500);
  });
}

function stopTunnel(tunnel: TunnelHandle | null): void {
  if (tunnel && tunnel.proc) {
    try {
      tunnel.proc.kill();
    } catch (_e) {
      /* already gone */
    }
  }
}

export { resolveCloudflaredBin, startTunnel, stopTunnel };
