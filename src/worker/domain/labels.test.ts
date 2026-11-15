import { describe, expect, test } from 'vitest';
import { labelKeyOf } from './event';
import { buildLabelCatalog, categoryNameOf, LabelDirectory } from './labels';

const cal = { id: 'c1', name: 'メイン', color: '#039be5' };

test('labelKeyOf', () => {
  expect(labelKeyOf({ eventLabelId: 'x', colorId: '3' })).toBe('label:x');
  expect(labelKeyOf({ eventLabelId: null, colorId: '3' })).toBe('color:3');
  expect(labelKeyOf({ eventLabelId: null, colorId: null })).toBe('none');
});

describe('カテゴリ名の決め方', () => {
  const name = (viewerName: string | null, globalName: string | null, sourceName: string) =>
    categoryNameOf({ viewerName, globalName, sourceName, calendarName: 'メイン' });
  test('閲覧者ごとの上書き → 全員共通の上書き → ラベル名 → カレンダー名', () => {
    expect(name('シフト', 'バイト', 'アルバイト')).toBe('シフト');
    expect(name(null, 'バイト', 'アルバイト')).toBe('バイト');
    expect(name(null, null, 'アルバイト')).toBe('アルバイト');
    expect(name(null, null, '')).toBe('メイン');
  });
  test('空白だけの上書きは、ないものとして扱う', () => {
    expect(name('  ', ' ', ' ')).toBe('メイン');
    expect(name(' ', 'バイト', 'アルバイト')).toBe('バイト');
  });
});

describe('LabelDirectory', () => {
  const catalog = buildLabelCatalog(cal, [{ id: 'L1', name: 'アルバイト', color: '#123456' }], { '7': '#039be5' });
  test('カタログ：ラベル1件 + colorId 11件 + ラベルなし', () => {
    expect(catalog).toHaveLength(13);
    expect(catalog.at(-1)?.labelKey).toBe('none');
  });
  test('ラベルの名前と色を使う', () => {
    const dir = new LabelDirectory([cal], catalog, []);
    expect(dir.describe('c1', 'label:L1')).toEqual({ categoryName: 'アルバイト', color: '#123456' });
  });
  test('表示名の上書き', () => {
    const dir = new LabelDirectory([cal], catalog, [{ calendarId: 'c1', labelKey: 'label:L1', displayName: 'バイト' }]);
    expect(dir.describe('c1', 'label:L1').categoryName).toBe('バイト');
  });
  test('colorId のラベルは名前がないのでカレンダー名、色はパレット', () => {
    const dir = new LabelDirectory([cal], catalog, []);
    expect(dir.describe('c1', 'color:7')).toEqual({ categoryName: 'メイン', color: '#039be5' });
  });
  test('ラベルなしはカレンダーの名前と色', () => {
    const dir = new LabelDirectory([cal], catalog, []);
    expect(dir.describe('c1', 'none')).toEqual({ categoryName: 'メイン', color: '#039be5' });
  });
  test('閲覧者ごとの上書きは、その閲覧者用の LabelDirectory だけに効く', () => {
    const base = new LabelDirectory([cal], catalog, [{ calendarId: 'c1', labelKey: 'label:L1', displayName: 'バイト' }]);
    const forViewer = base.withViewerNames([{ calendarId: 'c1', labelKey: 'label:L1', displayName: 'シフト' }]);
    expect(forViewer.describe('c1', 'label:L1').categoryName).toBe('シフト');
    expect(base.describe('c1', 'label:L1').categoryName).toBe('バイト');
  });
  test('カタログにないラベルはカレンダーの名前と色', () => {
    const dir = new LabelDirectory([cal], catalog, []);
    expect(dir.describe('c1', 'label:deleted')).toEqual({ categoryName: 'メイン', color: '#039be5' });
  });
});
