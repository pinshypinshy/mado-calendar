// fetch の薄いラッパー。エラーはサーバーの { error, message } を ApiError にして投げる。

import type { ApiError as ApiErrorBody } from '../../shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Http = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export const http: Http = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, err?.error ?? 'unknown', err?.message ?? `通信エラー（${res.status}）`);
  }
  return (await res.json()) as T;
};
