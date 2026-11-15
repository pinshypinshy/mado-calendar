// Google Cloud からダウンロードした OAuth クライアントの JSON を読み、.dev.vars を「本物の Google を使う」設定にする。
// 使い方：node scripts/set-google-dev-vars.mjs <JSON のパス> <運営者の Google アカウント>
// クライアント シークレットは画面に表示しない。.dev.vars は git の管理外。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [jsonPath, operatorEmail] = process.argv.slice(2);
if (!jsonPath || !operatorEmail) {
  console.error('使い方：node scripts/set-google-dev-vars.mjs <JSON のパス> <運営者の Google アカウント>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
const client = json.web ?? json.installed;
if (!client?.client_id || !client?.client_secret) {
  console.error('JSON に client_id と client_secret が見つかりません。「ウェブ アプリケーション」のクライアントの JSON を指定してください');
  process.exit(1);
}

const path = new URL('../.dev.vars', import.meta.url);
if (!existsSync(path)) {
  console.error('.dev.vars がありません。先に cp .dev.vars.example .dev.vars を実行してください');
  process.exit(1);
}

const values = {
  CALENDAR_SOURCE: 'google',
  OPERATOR_EMAIL: operatorEmail,
  GOOGLE_CLIENT_ID: client.client_id,
  GOOGLE_CLIENT_SECRET: client.client_secret,
};
let text = readFileSync(path, 'utf8');
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}
writeFileSync(path, text);
console.log(`.dev.vars を更新しました（CALENDAR_SOURCE=google、OPERATOR_EMAIL=${operatorEmail}、クライアント ID とシークレット）。シークレットは表示していません。`);
