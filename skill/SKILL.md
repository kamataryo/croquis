---
name: croquis
description: SVG の図（クロッキー）を描いてローカルのブラウザにライブ表示し、ユーザーの赤ペンのフィードバックを受け取る。説明に図があったほうがいいとき、ユーザーに図示を頼まれたとき、「クロッキーにフィードバックした」「赤ペンを入れた」と言われたときに使う。
---

# croquis

図は `drawing.svg` というファイルに書く。ブラウザのビューアが自動で更新される。API は `http://127.0.0.1:5199/api`。

API が応答しない（connection refused）ときは、先に `croquis open` を実行してサーバーを起動する。

## 図を描く

1. 作成する。返ってくる `drawingPath` が書き込み先
   ```sh
   curl -s -X POST http://127.0.0.1:5199/api/croquis -d '{"title":"認証フロー"}'
   # → {"id":3,"drawingPath":"/…/.croquis/3/drawing.svg"}
   ```
2. `drawingPath` に SVG を Write する
3. アクティブにする（ブラウザのタブが切り替わる）
   ```sh
   curl -s -X PUT http://127.0.0.1:5199/api/active -d '{"id":3}'
   ```
4. `croquis open 3`（ビューアが開いていなければ開く。開いていれば何もしない）

5. `croquis wait` を**バックグラウンドで**実行して（Bash の `run_in_background`）、応答を終える。ユーザーが「送る」を押すとコマンドが終了し、フィードバックの JSON が出力されて、自動で呼び戻される

## SVG の書き方

- ルートの `<svg>` に `viewBox` を付ける。背景は白の前提
- **主要な要素（ラベル、箱、矢印など）には必ず `id` を付ける**。フィードバックの `targets` はこの id で返ってくる
- `<script>`、`<foreignObject>`、イベント属性は表示のときに取り除かれるので使わない

## 修正する

- 小さな修正は `drawing.svg` を Edit する
- 全体を描き直すときは Write する

## フィードバックを受け取る

`croquis wait` が終了して呼び戻されたときは、その出力が未読のフィードバックなので、3 から始める。ユーザーに「送った」と言われたときは 1 から始める。

1. 対象を確認する（ユーザーがタブで選んだものが入っている）
   ```sh
   curl -s http://127.0.0.1:5199/api/active
   ```
2. 未読のフィードバックを取る
   ```sh
   curl -s http://127.0.0.1:5199/api/croquis/3/feedback
   ```
   - `comment`：ユーザーのコメント
   - `marks[]`：印ごとの `color`、`dash`、`bbox`（図の座標系で `[x, y, 幅, 高さ]`）、`targets`（囲まれた要素の id）
   - `snapshotPath`：図と赤ペンを重ねた PNG
3. `snapshotPath` の PNG を Read して、見た目を確かめる
4. `drawing.svg` を修正する
5. 既読にする
   ```sh
   curl -s -X DELETE http://127.0.0.1:5199/api/croquis/3/feedback
   ```
6. もう一度 `croquis wait` をバックグラウンドで実行して、次のフィードバックを待つ。必ず 5 の既読のあとに行う（未読が残っていると、すぐに終了してしまう）

## 色と線種の約束

- 赤の実線：直してほしい
- 青の破線：ここを参考に、ここと揃えて
- 緑：OK、このまま残して

## そのほかの API

- `GET /api/status`：ビューアの状態 `{open, visible, clients}`
- `GET /api/croquis`：一覧
- `GET /api/croquis/{n}`：取得
- `PUT /api/croquis/{n}`：`{title, drawing}` で更新
- `DELETE /api/croquis/{n}`：削除
