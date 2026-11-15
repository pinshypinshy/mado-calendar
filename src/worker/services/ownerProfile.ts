// オーナー自身のプロフィール（表示名。要件 3.9）。

import { AppError } from '../errors';
import type { OwnerRecord } from '../ports';

export const MAX_OWNER_NAME_LENGTH = 30;

/** そのオーナーの行だけを読み書きする口。container.ts でオーナーを固定して作る */
export interface OwnerProfileStore {
  get(): Promise<OwnerRecord | null>;
  setDisplayName(displayName: string): Promise<void>;
}

export class OwnerProfileService {
  constructor(private readonly store: OwnerProfileStore) {}

  async get(): Promise<OwnerRecord> {
    const owner = await this.store.get();
    if (!owner) throw new AppError('not_found', 'オーナーが見つかりません');
    return owner;
  }

  async setDisplayName(displayName: string): Promise<void> {
    const name = (displayName ?? '').trim();
    if (name.length > MAX_OWNER_NAME_LENGTH) {
      throw new AppError('bad_request', `表示名は${MAX_OWNER_NAME_LENGTH}文字以内で入力してください`);
    }
    await this.store.setDisplayName(name);
  }
}

/** 閲覧者に見せるオーナーの名前。空欄なら「（名前未設定）」（メールアドレスは見せない） */
export function ownerLabel(displayName: string): string {
  return displayName.trim() === '' ? '（名前未設定）' : displayName.trim();
}
