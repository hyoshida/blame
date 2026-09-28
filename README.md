# RECOIL CLIMB

## 開発

依存パッケージなし（Node 22）。

```sh
npm run build   # src/ を 1 ファイルに inline → dist/index.html
npm run solve   # ソルバーで頂上・外まで到達可能か検証（~25分）
                #   --full      記録片の回収も含めて全域を再探索
                #   --no-blast  壁撃ちを使わない道具だけのルートを検証（CI はこれ）
                #   --trace x,y 指定タイルの記録片に最初に届いた手順を表示
                #   --from x,y --abil ammo=1,breaker --open --goal 239 --print y0,y1,x0,x1
                #               区間テスト：指定地点・能力から指定の行まで届くかだけを数十秒で確認
node tools/charge-check.cjs      # 装甲板と核が溜め撃ちでだけ壊れることを実際の足場から確認（ソルバーは溜め撃ちを探索しない）
npm run serve   # dist をローカル配信
NODE_PATH=$(npm root -g) node tools/smoke.mjs   # ヘッドレスでスマホ表示のスモークテスト
```

| ファイル | 内容 |
| --- | --- |
| `src/level.js` | マップ（140×580 タイル。上 250 行が「外」）と看板・記録片・中継点。座標指定で区画を配置 |
| `src/physics.js` | 物理・弾の挙動・道具の効果。ゲームとソルバーで共有 |
| `src/game.js` | 描画・入力・音・セーブ |
| `tools/solve.mjs` | 到達可能性ソルバー（CI でも実行） |
| `tools/charge-check.cjs` | 溜め撃ちの検証（CI でも実行） |

調整しやすい数値は `src/physics.js` 冒頭の `C`（重力、反動など）。数値やマップを変えたら `npm run solve` で到達できることを確認する。

### デバッグ用 URL

- `#row60`: その行付近の足場から開始（それより下の道具と的は取得済み扱い。0 が最上段）
- `#at52,165`: 指定タイルから開始（`#at52,165+AB` のように道具も付与できる）
- デバッグメニュー: ポーズ画面を三本指でタップ（PC はポーズ中に D キー）。中継点・道具・記録片・要所・任意座標への転移、道具の所持状況の変更、中継点の全起動、殻の崩壊、弾の補充ができる

## デプロイ

`main` に push すると GitHub Actions がソルバー → ビルド → GitHub Pages へデプロイする（リポジトリ設定の Pages で Source を "GitHub Actions" にしておく）。

公開先: https://hyoshida.github.io/blame/
