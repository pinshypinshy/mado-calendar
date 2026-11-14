import { describe, expect, test } from 'vitest';
import type { SourceEvent } from './event';
import { BUSY_COLOR, displayTitle, presentForViewer } from './present';

const e: SourceEvent = {
  calendarId: 'c',
  id: 'secret-google-id',
  recurringEventId: null,
  title: '#歯医者',
  start: 1,
  end: 2,
  allDay: false,
  eventLabelId: null,
  colorId: '2',
};
const label = { categoryName: '通院', color: '#33b679' };

describe('presentForViewer', () => {
  test('詳細：タイトル・カテゴリ・ラベルの色', () => {
    expect(presentForViewer(e, 'detail', label, 'e0')).toEqual({
      id: 'e0', start: 1, end: 2, allDay: false, level: 'detail', title: '歯医者', category: '通院', color: '#33b679',
    });
  });
  test('カテゴリ：タイトルを返さない', () => {
    const v = presentForViewer(e, 'category', label, 'e0');
    expect(v).not.toHaveProperty('title');
    expect(v).toMatchObject({ level: 'category', category: '通院', color: '#33b679' });
  });
  test('予定あり：タイトルもカテゴリも返さず、グレー', () => {
    const v = presentForViewer(e, 'busy', label, 'e0');
    expect(v).toEqual({ id: 'e0', start: 1, end: 2, allDay: false, level: 'busy', color: BUSY_COLOR });
  });
  test('非表示：返さない', () => {
    expect(presentForViewer(e, 'hidden', label, 'e0')).toBeNull();
  });
  test('Google の予定 ID を返さない', () => {
    expect(JSON.stringify(presentForViewer(e, 'detail', label, 'e0'))).not.toContain('secret-google-id');
  });
});

test('displayTitle', () => {
  expect(displayTitle('# 通院')).toBe('通院');
  expect(displayTitle('＃通院')).toBe('＃通院');
  expect(displayTitle('#')).toBe('（タイトルなし）');
  expect(displayTitle('')).toBe('（タイトルなし）');
});
