// プライバシーポリシーへのリンク先が、実際に配信されるファイルであること（要件 7.4）。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PRIVACY_POLICY_PATH } from './PrivacyLink';

test('リンク先の privacy.html が public にある', () => {
  expect(existsSync(resolve(import.meta.dirname, '../../../public', `.${PRIVACY_POLICY_PATH}`))).toBe(true);
});
