import { ApiError } from '../api/http';

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return '通信できませんでした。電波の状態を確認してください';
  return 'エラーが発生しました';
}

export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
