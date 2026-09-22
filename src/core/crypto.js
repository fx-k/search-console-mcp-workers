const enc = new TextEncoder();

export function b64url(value) {
  const bytes = typeof value === 'string' ? enc.encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export function unb64url(text) {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error('Invalid base64url');
  return Uint8Array.from(atob(text.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
}

export async function sha256(value) {
  return crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : value);
}

export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(value));
}

export function hex(value) {
  return [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function pemToArrayBuffer(pem) {
  const body = String(pem).replace(/-----BEGIN PRIVATE KEY-----/gu, '').replace(/-----END PRIVATE KEY-----/gu, '').replace(/\s+/gu, '');
  if (!body) throw new Error('Google service account private_key is empty');
  const raw = atob(body);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return bytes.buffer;
}

export async function signRs256(privateKeyPem, data) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data));
}
