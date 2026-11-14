// 閲覧者 ID（要件 7.2）。
// 紛らわしい文字（0/O、1/I/L）を除いた大文字英数字31種類 × 20文字 ≒ 99ビット。
// 入力時は大文字・小文字を区別せず、ハイフンや空白は無視する。

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 20;

/** 乱数の取り出し方は注入する（テストで固定するため） */
export function generateViewerCode(randomBytes: (n: number) => Uint8Array): string {
  const n = CODE_ALPHABET.length;
  // 偏りをなくすため、n の倍数未満の値だけを使う（棄却法）
  const limit = 256 - (256 % n);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b < limit) code += CODE_ALPHABET[b % n];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

export function normalizeViewerCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s\-_]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** 見やすいよう4文字ごとにハイフンで区切る */
export function formatViewerCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}
