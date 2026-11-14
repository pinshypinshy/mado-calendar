// モジュールの依存の向きを守るためのテスト。破るとテストが失敗する。
// - domain：純粋なロジック。shared と domain 以外を import しない
// - services：ports（インターフェース）に依存し、adapters・http を import しない
// - web：worker を import しない（API の型は shared から読む）
// - shared：ほかの層を import しない

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const result: string[] = [];
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    result.push(spec.startsWith('.') ? relative(ROOT, resolve(dirname(file), spec)) : spec);
  }
  return result;
}

function violations(layer: string, allowed: (spec: string) => boolean): string[] {
  return filesUnder(join(ROOT, layer)).flatMap((f) =>
    importsOf(f)
      .filter((spec) => !allowed(spec))
      .map((spec) => `${relative(ROOT, f)} → ${spec}`),
  );
}

describe('依存の向き', () => {
  test('domain は shared と domain だけに依存する', () => {
    expect(violations('src/worker/domain', (s) => s.startsWith('src/shared/') || s.startsWith('src/worker/domain/'))).toEqual([]);
  });
  test('services は adapters・http・container に依存しない', () => {
    expect(
      violations('src/worker/services', (s) => !/^src\/worker\/(adapters|http|container)/.test(s) && !s.startsWith('node:')),
    ).toEqual([]);
  });
  test('web は worker に依存しない', () => {
    expect(violations('src/web', (s) => !s.startsWith('src/worker/'))).toEqual([]);
  });
  test('shared はほかの層に依存しない', () => {
    expect(violations('src/shared', (s) => s.startsWith('src/shared/'))).toEqual([]);
  });
});
