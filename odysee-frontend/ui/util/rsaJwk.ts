// HyperBEAM exports hosted wallets as minimal RSA JWKs (n, e, d only), while
// WebCrypto refuses to import a private RSA JWK without its CRT parameters.
// Recover p and q from (n, e, d) (e*d - 1 = 2^t * r; squaring g^r finds a
// non-trivial square root of 1 mod n) and derive dp, dq, qi. Pure BigInt.
// WebCrypto also rejects any JWK big-integer member encoded with leading zero
// octets (the node exports e as such), so re-encode every member minimally.
const RSA_BIGINT_MEMBERS = ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'] as const;

export function withRsaPrimes(source: JsonWebKey): JsonWebKey {
  const jwk: JsonWebKey = { ...source };
  for (const member of RSA_BIGINT_MEMBERS) {
    if (typeof jwk[member] === 'string' && jwk[member]) jwk[member] = toBase64Url(fromBase64Url(jwk[member]));
  }
  if (jwk.p && jwk.q && jwk.dp && jwk.dq && jwk.qi) return jwk;
  if (!jwk.n || !jwk.e || !jwk.d) throw new Error('RSA keyfile is incomplete');
  const n = fromBase64Url(jwk.n);
  const d = fromBase64Url(jwk.d);
  let r = fromBase64Url(jwk.e) * d - 1n;
  let t = 0n;
  while ((r & 1n) === 0n) {
    r >>= 1n;
    t += 1n;
  }
  let p = 0n;
  for (let g = 2n; p === 0n && g < 64n; g += 1n) {
    let x = modPow(g, r, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 0n; i < t; i += 1n) {
      const y = (x * x) % n;
      if (y === 1n) {
        p = gcd(x - 1n, n);
        break;
      }
      if (y === n - 1n) break;
      x = y;
    }
  }
  if (p <= 1n || p >= n || n % p !== 0n) throw new Error('RSA prime recovery failed');
  const q = n / p;
  return {
    ...jwk,
    p: toBase64Url(p),
    q: toBase64Url(q),
    dp: toBase64Url(d % (p - 1n)),
    dq: toBase64Url(d % (q - 1n)),
    qi: toBase64Url(modInverse(q, p)),
  };
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old, cur] = [a % m, m];
  let [oldS, s] = [1n, 0n];
  while (cur !== 0n) {
    const quotient = old / cur;
    [old, cur] = [cur, old - quotient * cur];
    [oldS, s] = [s, oldS - quotient * s];
  }
  if (old !== 1n) throw new Error('RSA CRT coefficient is undefined');
  return ((oldS % m) + m) % m;
}

function fromBase64Url(value: string): bigint {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  let hex = '';
  for (let i = 0; i < binary.length; i += 1) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  return BigInt(`0x${hex || '0'}`);
}

function toBase64Url(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
