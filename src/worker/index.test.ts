import { expect, test } from 'vitest';
import type { AppEnv } from './env';
import worker from './index';

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

test('本番のホストに http で来たら https へ転送する', async () => {
  const res = await worker.fetch(
    new Request('http://mado-cal.example.com/api/viewer/join?x=1', { method: 'POST' }),
    {} as AppEnv,
    ctx,
  );
  expect(res.status).toBe(308);
  expect(res.headers.get('Location')).toBe('https://mado-cal.example.com/api/viewer/join?x=1');
});

test('フェイクモードは localhost 以外では動かない', async () => {
  const res = await worker.fetch(
    new Request('https://mado-cal.example.com/api/viewer/me'),
    { CALENDAR_SOURCE: 'fake' } as AppEnv,
    ctx,
  );
  expect(res.status).toBe(500);
});
