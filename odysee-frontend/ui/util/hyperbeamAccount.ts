import { hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { isNativeMessageId } from 'util/nativeMessageVerification';

const ACCOUNT_KEY = 'hyperbeam-account';
const SAVED_KEY = 'hyperbeam-account-saved';
const COOKIE_PREFIX = 'secret-';
const MAX_ACCOUNT_NAME_LENGTH = 64;

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

export function hasNodeCookie(): boolean {
  return typeof document !== 'undefined' && document.cookie.includes(COOKIE_PREFIX);
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

export async function signUpHyperbeam(name: string): Promise<HyperbeamAccount> {
  const base = hyperbeamNodeBase();
  if (!base) throw new Error('No HyperBEAM node configured.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A name is required.');
  const hasControlCharacter = Array.from(trimmed).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (trimmed.length > MAX_ACCOUNT_NAME_LENGTH || hasControlCharacter) {
    throw new Error(`Name must be ${MAX_ACCOUNT_NAME_LENGTH} characters or fewer.`);
  }

  clearNodeCookies();
  const response = await fetch(`${base}/id?!=true&committers=all`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', type: 'channel', name: trimmed },
  });
  const body = await response.text();
  const id = response.headers.get('message-id') || nativeWriteId(body);
  if (!response.ok || !isNativeMessageId(id)) throw new Error(`Sign up failed (${response.status}).`);

  const account = { name: trimmed, id };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  localStorage.removeItem(SAVED_KEY);
  return account;
}

function nativeWriteId(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === 'string' ? parsed : typeof parsed?.body === 'string' ? parsed.body : '';
  } catch {
    return body.trim();
  }
}

export function logInHyperbeam(): HyperbeamAccount | null {
  if (!hasNodeCookie()) return null;
  const saved = read(SAVED_KEY);
  if (!saved) return null;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(saved));
  return saved;
}

export function signOutHyperbeam(): void {
  if (typeof localStorage === 'undefined') return;
  const current = read(ACCOUNT_KEY);
  if (current) localStorage.setItem(SAVED_KEY, JSON.stringify(current));
  localStorage.removeItem(ACCOUNT_KEY);
}
