# RECOIL CLIMB

## 開発

依存パッケージなし（Node 22）。

```sh
npm run build   # src/ を 1 ファイルに inline → dist/index.html
npm run solve   # ソルバーで道具の順に頂上・天国まで到達可能か検証（~3分。--full で羽根の回収も確認）
npm run serve   # dist をローカル配信
NODE_PATH=$(npm root -g) node tools/smoke.mjs   # ヘッドレスでスマホ表示のスモークテスト
```

| ファイル | 内容 |
| --- | --- |
| `src/level.js` | マップ（140×172 タイル）と看板の文言。座標指定で部屋を配置 |
| `src/physics.js` | 物理・弾の挙動・道具の効果。ゲームとソルバーで共有 |
| `src/game.js` | 描画・入力・音・セーブ |
| `tools/solve.mjs` | 到達可能性ソルバー（CI でも実行） |

調整しやすい数値は `src/physics.js` 冒頭の `C`（重力、反動など）。数値やマップを変えたら `npm run solve` で到達できることを確認する。

### デバッグ用 URL

- `#row60`: その行付近の足場から開始（それより下の道具と的は取得済み扱い。0 が最上段）
- `#at52,165`: 指定タイルから開始

## デプロイ

`main` に push すると GitHub Actions がソルバー → ビルド → GitHub Pages へデプロイする（リポジトリ設定の Pages で Source を "GitHub Actions" にしておく）。

公開先: https://hyoshida.github.io/blame/
