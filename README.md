# claude-croquis

Claude Code が SVG の図（クロッキー）を描き、ローカルのブラウザにライブ表示します。ユーザーは図に赤ペンを入れて、Claude にフィードバックを返せます。

> これは個人が作った非公式のツールです。Anthropic が提供・保証するものではありません。

## セットアップ

Node.js 22 以上と pnpm が必要です。

```sh
pnpm install
ln -s "$PWD/bin/croquis" ~/.local/bin/croquis   # PATH の通った場所へ
mkdir -p ~/.claude/skills/croquis && cp skill/SKILL.md ~/.claude/skills/croquis/
```

## 使い方

Claude Code に「図にして」と頼むと、スキルが図を描いてビューア（`http://127.0.0.1:5199`）を開きます。
図に赤ペンを入れ、コメントを書いて「送る」を押したあと、Claude に「フィードバックを見て」と伝えます。

- 手で開くとき：`croquis open [n]`
- `croquis wait [n]` は、フィードバックが届くまで待って内容を出力します。Claude がバックグラウンドで実行しておくと、「送る」を押すだけで Claude が読みに来ます
- データは `.croquis/` に入ります。Vite のログは `.croquis/vite.log` です
- API と手順は [skill/SKILL.md](skill/SKILL.md) にあります
- テスト：`pnpm test`

## 制約

- localhost 専用です（`127.0.0.1:5199` に bind）
- Claude Code のサンドボックスの中では、ブラウザを開く `open` とポートの bind が止められます。`croquis` コマンドはサンドボックスの外で動かす設定にしてください
