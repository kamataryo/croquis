# croquis - クロッキー

これは API でライブ操作できるシンプルなお絵描きサーバーで、 AI エージェントとコンテキストを共有することを想定したツールです。
今のところは Cloud Code のみを想定。

## セットアップ

Node.js 22 以上と pnpm が必要です。

```sh
git clone git@github.com:kamataryo/croquis.git
cd croquis
pnpm install
ln -s "$PWD/bin/croquis" ~/.local/bin/croquis   # PATH の通った場所へ
mkdir -p ~/.claude/skills/croquis && cp skill/SKILL.md ~/.claude/skills/croquis/ # スキルのインストール
```

## 使い方

`/croquis` スキルなどを通して Claude Code に「図にして」と頼むと、スキルが図を描いてビューア（`http://127.0.0.1:5199`）を開きます。
フィードバック機能付き。
「キューに追加」で複数のフィードバックをためておくと、「送る」で一度に届きます。

- 手で開くとき：`croquis open [n]`
- `croquis wait [n]` は、フィードバックが届くまで待って内容を出力します。Claude がバックグラウンドで実行しておくと、「送る」を押すだけで Claude が読みに来ます

## その他

- localhost 専用です（`127.0.0.1:5199` に bind）
- Claude Code のサンドボックスの中では、ブラウザを開く `open` とポートの bind が止められます。`croquis` コマンドはサンドボックスの外で動かす設定にしてください
- データは `.croquis/` に入ります。Vite のログは `.croquis/vite.log` です
- API と手順は [skill/SKILL.md](skill/SKILL.md) にあります
