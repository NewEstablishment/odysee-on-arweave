// HyperBEAM-native account: identity is a cookie the node's `~cookie@1.0`
// provider mints on the first committed write. The cookie IS the credential;
// the browser sends it automatically (credentials: 'include') on every later
// write, so uploads and comments share one signing identity with no token,
// password, or web2 backend. localStorage holds only the display name and the
// profile id for the UI, never anything secret.
//
// Session model:
//   sign up  -> mint a FRESH cookie identity + a channel profile with the name.
//   sign out -> keep the cookie (identity persists); hide the account, keep it
//               as the login hint.
//   log in   -> verify the cookie still owns the hinted profile or discover one
//               it owns; no session shows an error and keeps the hint.
//   boot     -> same check on a signed-in account; a final 401/403 forgets it.

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
  return read(ACCOUNT_KEY);
}

export function isHyperbeamSignedIn(): boolean {
  return Boolean(getHyperbeamAccount());
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
  const id =
    response.headers.get('message-id') ||
    (response.ok ? String((await response.json().catch(() => null))?.['message-id'] || '') : '');
  if (!response.ok || !id) throw new Error(`Sign up failed (${response.status}).`);

  const account = { name: trimmed, id };
  const { verifyHyperbeamAccountProfile } = await import('util/hyperbeam');
  if (!(await verifyHyperbeamAccountProfile(account))) {
    throw new Error('The new HyperBEAM account could not be verified against this browser session.');
  }
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

export async function recoverHyperbeamAccount(): Promise<HyperbeamAccount | null> {
  const { recoverHyperbeamAccountProfile } = await import('util/hyperbeam');
  const account = await recoverHyperbeamAccountProfile(read(ACCOUNT_KEY) || read(SAVED_KEY));
  if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

// Sign out without destroying the identity: hide the account but keep the
// cookie so `recoverHyperbeamAccount' can restore it. Remember it for that.
export function signOutHyperbeam(): void {
  if (typeof localStorage === 'undefined') return;
  const current = read(ACCOUNT_KEY);
  if (current) localStorage.setItem(SAVED_KEY, JSON.stringify(current));
  localStorage.removeItem(ACCOUNT_KEY);
}

// The node no longer knows this browser's identity (e.g. its store was
// reset): nothing can be restored, so stop presenting the account.
export function forgetHyperbeamAccount(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(SAVED_KEY);
}
