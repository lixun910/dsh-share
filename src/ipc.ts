export interface Auth {
  username: string;
  password: string;
}

export interface Settings {
  acknowledgedSecurityWarning: boolean;
  /** Keep the tunnel/dsh/proxy running when the window is closed (tray). */
  closeToTray: boolean;
}

/**
 * Status events pushed from the main process to the renderer on the `status`
 * channel. The `running` member is deliberately loose: the replay payload sent
 * on window reload carries `url`/`auth` but not `host`/`dshPort`, and the
 * renderer tolerates missing fields.
 */
export type StatusMessage =
  | { state: 'starting'; message: string }
  | { state: 'tunnel-up'; url: string; host: string; dshPort: number; auth: Auth; bootstrapToken: string }
  | {
      state: 'running';
      url?: string | null;
      host?: string;
      dshPort?: number;
      auth?: Auth | null;
      bootstrapToken?: string | null;
    }
  | { state: 'error'; message: string }
  | { state: 'stopped' };

/** Live session state exposed via the `/~dsh-share/session` status endpoint. */
export type SessionState = 'starting' | 'tunnel-up' | 'running' | 'error' | 'stopped';

/**
 * The payload served at `/~dsh-share/session` (behind the same basic auth as
 * the rest of the tunnel). `connection` is present only while the proxy is
 * running; it carries the exact creds the live proxy uses plus the dsh:// URI,
 * so an authenticated mobile client can self-heal if the desktop ever changes
 * the URI under the same credentials.
 */
export interface SessionStatus {
  app: string;
  version: string;
  session: {
    state: SessionState;
    publicUrl: string | null;
    host: string | null;
    dshPort: number | null;
    startedAt: number | null;
  };
  connection: { uri: string; username: string; password: string } | null;
}

/** The API `window.dshShare` exposes to the renderer via the preload bridge. */
export interface DshShareApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  getAuth(): Promise<Auth>;
  regenerateAuth(): Promise<Auth>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  openLocal(): Promise<void>;
  openUrl(url: string): Promise<void>;
  checkDshConflict(): Promise<boolean>;
  stopDshOnPort(): Promise<boolean>;
  onStatus(cb: (status: StatusMessage) => void): void;
  onLog(cb: (line: string) => void): void;
}
