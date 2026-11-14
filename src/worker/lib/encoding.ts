// base64url と SHA-256。外部の状態に依存しない純粋な関数なので、サービスから直接使ってよい。

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export function base64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Base64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('invalid JWT');
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(part))) as Record<string, unknown>;
}
