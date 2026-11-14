// 時計・乱数・暗号の実装（Web Crypto）。

import { base64ToBytes, base64url, base64urlToBytes } from '../lib/encoding';
import type { Clock, Random, SecretBox } from '../ports';

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoRandom: Random = {
  bytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  token: () => base64url(crypto.getRandomValues(new Uint8Array(32))),
};

/**
 * AES-GCM による暗号化と、HMAC-SHA256 による照合用ハッシュ。
 * 1つの Secret（32バイト）から HKDF で用途別の鍵を2つ作る（同じ鍵を2つの用途に使わないため）。
 */
export async function createSecretBox(base64Key: string, random: Random): Promise<SecretBox> {
  const raw = base64ToBytes(base64Key);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY は32バイトを base64 で表した値にしてください');
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: new TextEncoder().encode(info),
  });
  const aesKey = await crypto.subtle.deriveKey(hkdf('mado-cal/enc/v1'), master, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const hmacKey = await crypto.subtle.deriveKey(
    hkdf('mado-cal/hash/v1'),
    master,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );

  return {
    async encrypt(plain) {
      const iv = new Uint8Array(random.bytes(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plain));
      return `v1.${base64url(iv)}.${base64url(new Uint8Array(ct))}`;
    },
    async decrypt(sealed) {
      const [version, iv, ct] = sealed.split('.');
      if (version !== 'v1' || !iv || !ct) throw new Error('unsupported ciphertext');
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64urlToBytes(iv) },
        aesKey,
        base64urlToBytes(ct),
      );
      return new TextDecoder().decode(plain);
    },
    async hash(value) {
      const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value));
      return base64url(new Uint8Array(sig));
    },
  };
}
