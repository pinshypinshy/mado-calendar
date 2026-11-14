// サービスが投げるエラー。routes で HTTP のステータスに変換する。

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'too_many_requests'
  | 'calendar_not_connected'
  | 'upstream_error';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  too_many_requests: 429,
  calendar_not_connected: 503,
  upstream_error: 502,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** リフレッシュトークンが失効・取り消しされた */
export class OAuthRevokedError extends Error {
  constructor(message = 'refresh token revoked') {
    super(message);
    this.name = 'OAuthRevokedError';
  }
}
