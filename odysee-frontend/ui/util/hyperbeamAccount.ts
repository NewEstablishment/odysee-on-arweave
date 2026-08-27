// HyperBEAM-native account: identity is a cookie the node's `~cookie@1.0`
// provider mints on the first committed write. The cookie IS the credential;
// the browser sends it automatically (credentials: 'include') on every later
// write, so uploads and comments share one signing identity with no token,
// password, or web2 backend. localStorage holds only the display name and the
// profile id for the UI, never anything secret.
//
// Session model:
//   sign up  -> mint a FRESH cookie identity + a channel profile with the name.
//   sign out -> keep the cookie (identity persists), just hide the account.
//   log in   -> the cookie is still there, so restore the account.
//
// Future: swap the node's secret-provider from `~cookie@1.0' to an `oauth@1.0'
// device for a portable, recoverable identity. This frontend contract is
// unchanged.

import { hyperbeamNodeBase } from 'util/hyperbeamDevices';

const ACCOUNT_KEY = 'hyperbeam-account';
const SAVED_KEY = 'hyperbeam-account-saved';
const COOKIE_PREFIX = 'secret-';

export type HyperbeamAccount = { name: string; id: string };

function read(key: string): HyperbeamAccount | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getHyperbeamAccount(): HyperbeamAccount | null {
  const account = read(ACCOUNT_KEY);
  if (account && typeof localStorage !== 'undefined') {
    localStorage.setItem(SAVED_KEY, JSON.stringify(account));
  }
  return account;
}

export function isHyperbeamSignedIn(): boolean {
  return Boolean(getHyperbeamAccount());
}

// The node cookie may be HttpOnly, so JavaScript cannot use document.cookie
// to determine whether it is present. The saved profile is the browser's
// signed-out-session marker; the node remains the authority on the next write.
export function canLogInHyperbeam(): boolean {
  return Boolean(read(SAVED_KEY));
}

function clearNodeCookies(): void {
  if (typeof document === 'undefined') return;
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0].trim();
    if (name.startsWith(COOKIE_PREFIX)) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });
}

// Create a fresh identity: drop any existing cookie so the node mints a new
// one, then commit a channel profile with the given name.
export async function signUpHyperbeam(name: string): Promise<HyperbeamAccount> {
  const base = hyperbeamNodeBase();
  if (!base) throw new Error('No HyperBEAM node configured.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A name is required.');

  clearNodeCookies();

  const response = await fetch(`${base}/id?0.%21=true&committers=all`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', type: 'channel', name: trimmed },
  });
  let id = response.headers.get('message-id') || '';
  if (response.ok && !id) {
    try {
      id = String((await response.json())['message-id'] || '');
    } catch (e) {}
  }
  if (!response.ok || !id) {
    throw new Error(`Sign up failed (${response.status}).`);
  }

  const account = { name: trimmed, id };
  const { verifyHyperbeamAccountProfile } = await import('util/hyperbeam');
  if (!(await verifyHyperbeamAccountProfile(account))) {
    throw new Error('The new HyperBEAM account could not be verified against this browser session.');
  }
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  localStorage.setItem(SAVED_KEY, JSON.stringify(account));
  return account;
}

// A saved profile is only a UI hint. Login always asks the node to prove that
// the opaque cookie owns the exact committed profile before restoring it.
export async function logInHyperbeam(): Promise<HyperbeamAccount | null> {
  return recoverHyperbeamAccount();
}

export async function recoverHyperbeamAccount(): Promise<HyperbeamAccount | null> {
  const { recoverHyperbeamAccountProfile } = await import('util/hyperbeam');
  const account = await recoverHyperbeamAccountProfile();
  if (!account) return null;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  localStorage.setItem(SAVED_KEY, JSON.stringify(account));
  return account;
}

// Sign out without destroying the identity: hide the account but keep the
// cookie so `logInHyperbeam' can restore it. Remember the account for that.
export function signOutHyperbeam(): void {
  if (typeof localStorage === 'undefined') return;
  const current = read(ACCOUNT_KEY);
  if (current) localStorage.setItem(SAVED_KEY, JSON.stringify(current));
  localStorage.removeItem(ACCOUNT_KEY);
}
