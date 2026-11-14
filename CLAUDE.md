# CLAUDE.md

## 最初に読むもの

- [docs/requirements.md](docs/requirements.md)：要件。仕様に解釈の余地がある場合や、要件と食い違う設計判断が必要な場合は、推測で進めずにオーナーに確認する
- [docs/design.md](docs/design.md)：設計と、その理由。設計を変えたらこちらも直す
- [README.md](README.md)：コマンドの手順

## 作業のルール

- 変更したら `npm run typecheck` と `npm test` を通す。
- 依存の向き（domain → ports → services → adapters / http → container）を守る。破ると `src/architecture.test.ts` が失敗する。テストを直して通すのではなく、依存を直す。
- 外部とやり取りする処理（D1、Google、時計、乱数、暗号）は `src/worker/ports.ts` のインターフェースを通す。実装を選ぶのは `src/worker/container.ts` だけ。
- Cloudflare（Workers、D1、無料プランの上限）や Google（Calendar API、OAuth）、Safari の仕様を判断の根拠にするときは、公式ドキュメントで確かめる。確かめられない場合は、未確認であることを書く。
- 運用費は0円が必須（Cloudflare の無料プランだけで動かす）。上限は要件定義書の 8.2 を参照。
- 閲覧者に返すデータを増やすときは、要件 7.1（説明欄・場所・参加者などを返さない）を守る。
- コードのコメントと文書は日本語で書く。

## ローカル開発

- `.dev.vars` で `CALENDAR_SOURCE=fake` にすると、Google につながずに動く（localhost でのみ）。
- テストは Node 上の Vitest で動く。D1 は wrangler の `getPlatformProxy` でメモリ上のものを使う（`src/worker/testing/harness.ts`）。
