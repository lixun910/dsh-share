import { randomBytes } from 'crypto';
import * as http from 'http';
import * as net from 'net';
import type { SessionStatus } from './ipc';

/**
 * The reserved path where the app serves its live session status. Intercepted
 * here (before forwarding) so it never reaches dsh — the `~` prefix can't
 * collide with dsh's routes.
 */
export const SESSION_PATH = '/~dsh-share/session';

/**
 * Injected into served HTML so iOS Safari reconnects after backgrounding.
 * WebKit silently kills WebSockets in backgrounded tabs without firing `close`
 * (webkit bug 228296); dsh's live streams are receive-only with no heartbeat,
 * so the page never notices and misses events (e.g. ask-user-question) pushed
 * while away. Reloading forces a fresh connection — the host replays pending
 * questions/approvals on the new mux stream. Only fires after a real
 * background period (>30s), never during active use.
 */
const HTML_INJECT =
  '<script>(function(){var h=0;function m(){h=Date.now()}function r(){if(!h)return;var a=Date.now()-h;h=0;if(a>30000)location.reload()}document.addEventListener("visibilitychange",function(){document.visibilityState==="hidden"?m():r()});window.addEventListener("pagehide",m);window.addEventListener("pageshow",function(e){if(e.persisted)r()})})();<\/script>';

/**
 * Find a free TCP port on loopback.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('server did not bind'));
      }
    });
  });
}

/**
 * Create a local reverse proxy that enforces HTTP Basic auth and forwards to
 * `targetPort`. Used to put auth in front of dsh, since Cloudflare quick
 * tunnels don't provide it.
 */
function createAuthProxy(opts: {
  listenPort: number;
  targetPort: number;
  username: string;
  password: string;
  /** Per-session bootstrap token embedded in the QR's public URL. */
  bootstrapToken?: string;
  onLog?: (line: string) => void;
  /** Live session status served at SESSION_PATH (null = stopped). */
  getStatus?: () => SessionStatus | null;
}): Promise<http.Server> {
  const { listenPort, targetPort, username, password, bootstrapToken, onLog, getStatus } = opts;
  const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  // Alternative auth via ?u=&p= query params. iOS WKWebView never calls its
  // auth challenge handler for WebSocket handshakes (Apple bug r.25491679),
  // and the browser WebSocket API can't set headers, so the dsh-mobile app
  // rewrites WebSocket URLs to carry the credentials in the query string.
  // The dsh server ignores extra query params (it routes on pathname only).
  const authFromQuery = (req: http.IncomingMessage): boolean => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('u') === username && url.searchParams.get('p') === password;
  };

  // Session-cookie auth so WebSocket handshakes work in Safari/iOS. WebKit
  // never attaches HTTP Basic credentials to a WebSocket upgrade (webkit bug
  // 80362), but it does send cookies, so after the first successful Basic (or
  // ?u=&p=) request we set an HttpOnly cookie the upgrade path accepts. The
  // token is per-proxy-run; quick tunnels mint a fresh host on every start,
  // so a stale cookie belongs to a dead origin and is harmless.
  const AUTH_COOKIE = 'dsh_share_auth';
  const authCookie = randomBytes(24).toString('hex');

  const hasAuthCookie = (req: http.IncomingMessage): boolean => {
    const cookie = req.headers.cookie;
    if (!cookie) return false;
    return cookie.split(';').some((part) => {
      const eq = part.indexOf('=');
      return eq !== -1 && part.slice(0, eq).trim() === AUTH_COOKIE && part.slice(eq + 1).trim() === authCookie;
    });
  };

  const isAuthed = (req: http.IncomingMessage): boolean =>
    req.headers.authorization === expected || authFromQuery(req) || hasAuthCookie(req);

  // Bootstrap-token auth: the dsh-mobile app scans the plain public URL from
  // the QR, then exchanges the `dsh_share` token for the live credentials via
  // the session endpoint. The token is deliberately scoped to SESSION_PATH only
  // (checked in the request handler) so it can never unlock the tunnel itself.
  const authFromToken = (req: http.IncomingMessage): boolean => {
    if (!bootstrapToken) return false;
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('dsh_share') === bootstrapToken;
  };

  // Append our auth cookie to a response, preserving any Set-Cookie dsh
  // produced (proxyRes.headers lowercases the key to `set-cookie`). No Secure
  // flag: the tunnel terminates TLS at Cloudflare and the inner leg is
  // loopback-only, so the cookie never crosses a plaintext hop.
  const withAuthCookie = (headers: http.OutgoingHttpHeaders): http.OutgoingHttpHeaders => {
    const existing = headers['set-cookie'];
    const ours = `${AUTH_COOKIE}=${authCookie}; HttpOnly; SameSite=Strict; Path=/`;
    const setCookie = existing === undefined ? ours : Array.isArray(existing) ? [...existing, ours] : [existing, ours];
    return { ...headers, 'set-cookie': setCookie };
  };

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const authed = isAuthed(req);
    const tokenAuthed = authFromToken(req);
    // Session status is served by this app, never forwarded to dsh. The
    // bootstrap token (from the QR's public URL) unlocks this endpoint alone,
    // so a phone that scanned the plain link can fetch the live credentials.
    if (pathname === SESSION_PATH) {
      if (!authed && !tokenAuthed) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dsh-share"' });
        res.end('Unauthorized');
        return;
      }
      const status = getStatus ? getStatus() : null;
      res.writeHead(
        200,
        withAuthCookie({
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
      );
      res.end(JSON.stringify(status));
      return;
    }
    if (!authed) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dsh-share"' });
      res.end('Unauthorized');
      return;
    }
    const proxyReq = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: req.headers.host },
      },
      (proxyRes) => {
        // Inject the iOS-reconnect script into the app-shell HTML (served
        // uncompressed and chunked by dsh's frontend-static, so buffering is
        // cheap and no content-length needs fixing). Everything else pipes.
        const contentType = proxyRes.headers['content-type'];
        const isHtml = typeof contentType === 'string' && contentType.startsWith('text/html');
        const isCompressed = proxyRes.headers['content-encoding'] !== undefined;
        if (isHtml && !isCompressed) {
          const chunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => chunks.push(c));
          proxyRes.on('end', () => {
            let body = Buffer.concat(chunks).toString('utf8');
            body = body.includes('</body>') ? body.replace('</body>', HTML_INJECT + '</body>') : body + HTML_INJECT;
            const headers = { ...proxyRes.headers };
            delete headers['content-length'];
            res.writeHead(proxyRes.statusCode ?? 200, withAuthCookie(headers));
            res.end(body);
          });
          proxyRes.on('error', () => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Bad gateway');
          });
        } else {
          res.writeHead(proxyRes.statusCode ?? 502, withAuthCookie(proxyRes.headers));
          proxyRes.pipe(res);
        }
      }
    );
    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad gateway');
    });
    req.pipe(proxyReq);
  });

  // Forward WebSocket upgrades (dsh may use them for live client connections).
  server.on('upgrade', (req, socket, head) => {
    if (!isAuthed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: req.headers.host },
    });
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        socket.write(`${k}: ${v}\r\n`);
      }
      socket.write('\r\n');
      if (proxyHead && proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on('error', () => socket.destroy());
    proxyReq.end();
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      onLog && onLog(`Auth proxy listening on 127.0.0.1:${listenPort}\n`);
      resolve(server);
    });
  });
}

function stopProxy(server: http.Server | null): void {
  if (server) {
    try {
      server.close();
    } catch (_e) {
      /* already closed */
    }
  }
}

/**
 * Poll until a TCP port on loopback accepts connections, or the timeout hits.
 * @returns true if the port came up.
 */
function waitForPort(port: number, timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

/**
 * Check whether a TCP port on loopback is currently accepting connections.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
}

export { createAuthProxy, stopProxy, getFreePort, waitForPort, isPortInUse };
