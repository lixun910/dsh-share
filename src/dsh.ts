import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Locate the dsh launcher entry (`@deepseek-ai/dsh/lib/bin.js`).
 * Resolution order:
 *   1. $DSH_BIN (explicit override)
 *   2. a bundled copy under node_modules/@deepseek-ai/dsh
 *   3. the npx cache (~/.npm/_npx/<hash>/node_modules/@deepseek-ai/dsh)
 */
function resolveDshBin(): string {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;

  const candidates = [];
  if (process.resourcesPath) {
    // Packaged app: dsh lives in the (unpacked) asar under resources.
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    );
    candidates.push(
      path.join(process.resourcesPath, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    );
  }
  // Dev / source layout.
  candidates.push(path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // npx cache fallback.
  const npxDir = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npxDir)) {
    for (const entry of fs.readdirSync(npxDir)) {
      const candidate = path.join(npxDir, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    'Could not locate the dsh launcher. Set DSH_BIN to the path of ' +
    '@deepseek-ai/dsh/lib/bin.js, or bundle @deepseek-ai/dsh into this app.'
  );
}

/**
 * Start `dsh web --trusted-host <host> [--port <port>]`.
 * Runs under Electron's embedded Node via ELECTRON_RUN_AS_NODE.
 * @param host the public tunnel host to trust.
 * @param port explicit listen port (defaults to dsh's own 3080).
 */
function startDsh(host: string, port: number, onLog?: (line: string) => void): ChildProcess {
  const bin = resolveDshBin();
  // dsh's HMR service needs Node's internal module loader, which requires
  // --expose-internals. The loader's node-addon-require-builtin fallback
  // doesn't load under Electron's embedded Node (different ABI), so the flag
  // is the only reliable path.
  const args = ['--expose-internals', bin, 'web', '--trusted-host', host];
  if (port) args.push('--port', String(port));
  const proc = spawn(process.execPath, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => onLog && onLog(d.toString()));
  proc.stderr.on('data', (d) => onLog && onLog(d.toString()));
  proc.on('error', (err) => onLog && onLog(`dsh error: ${err.message}\n`));
  return proc;
}

function stopDsh(proc: ChildProcess | null): void {
  if (proc) {
    try {
      proc.kill();
    } catch (_e) {
      /* already gone */
    }
  }
}

export { resolveDshBin, startDsh, stopDsh };
