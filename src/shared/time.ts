// 日付・時刻のユーティリティ。タイムゾーンは Asia/Tokyo 固定（要件 2章）。
// 日本は夏時間がないので、UTC+9 の固定オフセットで計算する。
// 実行環境（Workers は UTC、ブラウザは端末の設定）のタイムゾーンに依存しないよう、
// Date のローカル時刻メソッド（getHours など）は使わない。

/** JST の日付。形式は YYYY-MM-DD */
export type DateStr = string;

export type WeekStart = 0 | 1; // 0 = 日曜、1 = 月曜

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateStr(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** epoch ミリ秒 → その時刻の JST の日付 */
export function jstDateOf(ms: number): DateStr {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の日付 → その日の 0:00（JST）の epoch ミリ秒 */
export function jstMidnight(date: DateStr): number {
  return Date.parse(`${date}T00:00:00Z`) - JST_OFFSET_MS;
}

/** 0:00 からの経過分（JST） */
export function jstMinutesOfDay(ms: number): number {
  return Math.floor((((ms + JST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS);
}

export function addDays(date: DateStr, days: number): DateStr {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 月を足す。日が存在しない場合は月末に丸める（1/31 + 1か月 = 2/28 など） */
export function addMonths(date: DateStr, months: number): DateStr {
  const [y, m, d] = splitDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const day = Math.min(d, daysInMonth(ny, nm));
  return formatDate(ny, nm, day);
}

/** 曜日。0 = 日曜 … 6 = 土曜 */
export function weekdayOf(date: DateStr): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function startOfWeek(date: DateStr, weekStart: WeekStart): DateStr {
  const diff = (weekdayOf(date) - weekStart + 7) % 7;
  return addDays(date, -diff);
}

export function startOfMonth(date: DateStr): DateStr {
  return `${date.slice(0, 7)}-01`;
}

/** b - a の日数 */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** "HH:MM"（JST） */
export function formatTime(ms: number): string {
  const min = jstMinutesOfDay(ms);
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function splitDate(date: DateStr): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(y: number, m: number, d: number): DateStr {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
