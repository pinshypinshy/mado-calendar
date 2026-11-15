// 運営者によるオーナーの管理（要件 3.10）。
// 運営者に見せるのは、オーナーの一覧の項目（メールアドレス・表示名・最終ログイン日時）だけ。

import type { OwnerSummary } from '../../shared/api';
import { AppError } from '../errors';
import { base64url } from '../lib/encoding';
import type { Clock, GlobalRepositories, OwnerRecord, Random } from '../ports';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OperatorDeps {
  global: Pick<GlobalRepositories, 'owners'>;
  random: Random;
  clock: Clock;
  operatorEmail: string;
}

export class OperatorService {
  constructor(private readonly d: OperatorDeps) {}

  async listOwners(): Promise<OwnerSummary[]> {
    return (await this.d.global.owners.list()).map((o) => this.toSummary(o));
  }

  async addOwner(email: string): Promise<OwnerSummary> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
      throw new AppError('bad_request', 'メールアドレスの形式が正しくありません');
    }
    if (await this.d.global.owners.findByEmail(normalized)) {
      throw new AppError('bad_request', 'このメールアドレスは、すでにオーナーとして登録されています');
    }
    const owner: OwnerRecord = {
      id: base64url(this.d.random.bytes(12)),
      email: normalized,
      displayName: '',
      createdAt: this.d.clock.now(),
      lastLoginAt: null,
    };
    await this.d.global.owners.insert(owner);
    return this.toSummary(owner);
  }

  /** オーナーと、そのオーナーのデータをすべて消す。運営者自身は消せない */
  async deleteOwner(ownerId: string): Promise<void> {
    const owner = await this.d.global.owners.get(ownerId);
    if (!owner) throw new AppError('not_found', 'オーナーが見つかりません');
    if (this.isOperator(owner)) throw new AppError('bad_request', '運営者自身は削除できません');
    await this.d.global.owners.delete(ownerId);
  }

  private isOperator(o: OwnerRecord): boolean {
    return o.email === this.d.operatorEmail.toLowerCase();
  }

  private toSummary(o: OwnerRecord): OwnerSummary {
    return {
      id: o.id,
      email: o.email,
      displayName: o.displayName,
      createdAt: o.createdAt,
      lastLoginAt: o.lastLoginAt,
      isOperator: this.isOperator(o),
    };
  }
}
