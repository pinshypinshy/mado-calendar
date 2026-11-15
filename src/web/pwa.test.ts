// ホーム画面に追加したときの起動先（要件 7.5）。閲覧画面と管理画面を別のアプリとして追加できること。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const manifestOf = (html: string) => /<link rel="manifest" href="\/([^"]+)"/.exec(html)?.[1];

test('閲覧画面は / から起動する', () => {
  const manifest = JSON.parse(read(`public/${manifestOf(read('index.html'))}`));
  expect(manifest).toMatchObject({ id: '/', start_url: '/', name: '窓カレンダー' });
});

test('管理画面は /admin から起動する、別のアプリ', () => {
  const html = read('admin.html');
  const manifest = JSON.parse(read(`public/${manifestOf(html)}`));
  expect(manifest).toMatchObject({ id: '/admin', start_url: '/admin', name: '窓カレンダー 管理' });
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="窓カレンダー 管理" />');
});
