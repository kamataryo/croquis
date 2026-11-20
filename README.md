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

クロッキー 1 つが、ブラウザのタブ 1 つになります（`http://127.0.0.1:5199/#3`）。**タブを閉じると、そのクロッキーは 1 分後に消えます。**

- リロードでは消えません。間違えて閉じたときは、1 分以内に開き直せば（Cmd+Shift+T）残ります
- 未読のフィードバックがあるクロッキーは、Claude が読み終わるまで残ります
- ブラウザがメモリ節約のために破棄したタブは、閉じた扱いになりません
- 一度も開かなかったものなどの残りは、最後に触ってから 24 時間で消えます

コマンド：

- `croquis open [n]`：クロッキー n のタブを開きます。n を省くと、空のクロッキーを作って開きます（下絵を描いて送るとき）
- `croquis start`：サーバーを起動するだけ
- `croquis wait [n]`：フィードバックが届くまで待って内容を出力します。Claude がバックグラウンドで実行しておくと、「送る」を押すだけで Claude が読みに来ます。待っていないときは、送ったあと Claude に「フィードバックした」と伝えてください

## その他

- localhost 専用です（`127.0.0.1:5199` に bind）
- Claude Code のサンドボックスの中では、ブラウザを開く `open` とポートの bind が止められます。`croquis` コマンドはサンドボックスの外で動かす設定にしてください
- データは `.croquis/` に入ります。Vite のログは `.croquis/vite.log` です
- API と手順は [skill/SKILL.md](skill/SKILL.md) にあります
