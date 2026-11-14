import { expect, test } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, formatViewerCode, generateViewerCode, normalizeViewerCode } from './viewerCode';

test('紛らわしい文字を含まない', () => {
  for (const ch of '0O1IL') expect(CODE_ALPHABET).not.toContain(ch);
});

test('80ビット以上', () => {
  expect(CODE_LENGTH * Math.log2(CODE_ALPHABET.length)).toBeGreaterThanOrEqual(80);
});

test('棄却法：上限以上のバイトは使わない', () => {
  let call = 0;
  const code = generateViewerCode((n) => {
    call++;
    // 1回目はすべて棄却される値、2回目から使える値
    return new Uint8Array(n).fill(call === 1 ? 255 : 0);
  });
  expect(code).toBe(CODE_ALPHABET[0]!.repeat(CODE_LENGTH));
});

test('正規化：小文字・ハイフン・空白を許す', () => {
  const code = generateViewerCode((n) => crypto.getRandomValues(new Uint8Array(n)));
  const formatted = formatViewerCode(code);
  expect(formatted).toMatch(/^(\w{4}-){4}\w{4}$/);
  expect(normalizeViewerCode(formatted.toLowerCase().replace(/-/g, ' '))).toBe(code);
});

test('正規化：長さや文字が違えば null', () => {
  expect(normalizeViewerCode('ABC')).toBeNull();
  expect(normalizeViewerCode('0'.repeat(CODE_LENGTH))).toBeNull();
});
