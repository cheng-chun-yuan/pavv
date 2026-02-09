/**
 * Session Lifecycle Manager
 *
 * Holds the decrypted share OUTSIDE of React state.
 * Provides time-bounded session with auto-destruction.
 *
 * SECURITY: Secrets live here in a module-scoped variable,
 * never in React state, Redux, or localStorage.
 */

import type { ShareData } from "../store/treasury";

export interface SignerSession {
  share: ShareData;
  noncesRemaining: number;
  startedAt: number;
  expiresAt: number;
  viewingSecretKey: string;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let _session: SignerSession | null = null;
let _timeoutId: ReturnType<typeof setTimeout> | null = null;
let _onExpireCallback: (() => void) | null = null;

/**
 * Start a new session with a decrypted share.
 * Auto-destroys after SESSION_TIMEOUT_MS.
 */
export function startSession(
  share: ShareData,
  noncesRemaining: number,
  onExpire: () => void,
  viewingSecretKey: string = ""
): void {
  // Destroy any existing session first
  destroySession();

  const now = Date.now();
  _session = {
    share,
    noncesRemaining,
    startedAt: now,
    expiresAt: now + SESSION_TIMEOUT_MS,
    viewingSecretKey,
  };
  _onExpireCallback = onExpire;

  _timeoutId = setTimeout(() => {
    destroySession();
    onExpire();
  }, SESSION_TIMEOUT_MS);
}

/** Get the current session, or null if none active. */
export function getSession(): SignerSession | null {
  if (!_session) return null;
  if (Date.now() >= _session.expiresAt) {
    destroySession();
    _onExpireCallback?.();
    return null;
  }
  return _session;
}

/** Reset the session timeout (call on user activity). */
export function extendSession(): void {
  if (!_session || !_onExpireCallback) return;

  const now = Date.now();
  _session.expiresAt = now + SESSION_TIMEOUT_MS;

  if (_timeoutId !== null) {
    clearTimeout(_timeoutId);
  }

  const cb = _onExpireCallback;
  _timeoutId = setTimeout(() => {
    destroySession();
    cb();
  }, SESSION_TIMEOUT_MS);
}

/**
 * Destroy the current session.
 * Overwrites the share's secretShare with empty string,
 * clears the timeout, and nullifies the session reference.
 */
export function destroySession(): void {
  if (_session) {
    // Best-effort zeroing of the secret in memory
    _session.share.secretShare = "";
    _session.viewingSecretKey = "";
    _session.share = null as unknown as ShareData;
    _session = null;
  }
  if (_timeoutId !== null) {
    clearTimeout(_timeoutId);
    _timeoutId = null;
  }
  _onExpireCallback = null;
}

/** Milliseconds remaining in the current session, or 0 if no session. */
export function getSessionTimeRemaining(): number {
  if (!_session) return 0;
  return Math.max(0, _session.expiresAt - Date.now());
}

/** Get the viewing secret key from the current session, or null. */
export function getViewingSecretKey(): string | null {
  const session = getSession();
  return session?.viewingSecretKey || null;
}

/** Whether a session is currently active. */
export function hasActiveSession(): boolean {
  return getSession() !== null;
}
