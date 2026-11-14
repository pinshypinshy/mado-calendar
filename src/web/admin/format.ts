import { jstDateOf } from '../../shared/time';
import { formatDateJa } from '../calendar/layout';
import { formatTime } from '../../shared/time';

export function formatDateTime(ms: number): string {
  return `${formatDateJa(jstDateOf(ms))} ${formatTime(ms)}`;
}
