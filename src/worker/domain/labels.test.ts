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
  test('上書き → ラベル名 → カレンダー名', () => {
    expect(categoryNameOf('バイト', 'アルバイト', 'メイン')).toBe('バイト');
    expect(categoryNameOf(null, 'アルバイト', 'メイン')).toBe('アルバイト');
    expect(categoryNameOf(null, '', 'メイン')).toBe('メイン');
    expect(categoryNameOf('  ', ' ', 'メイン')).toBe('メイン');
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
  test('カタログにないラベルはカレンダーの名前と色', () => {
    const dir = new LabelDirectory([cal], catalog, []);
    expect(dir.describe('c1', 'label:deleted')).toEqual({ categoryName: 'メイン', color: '#039be5' });
  });
});
