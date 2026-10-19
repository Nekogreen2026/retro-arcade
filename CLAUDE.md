# CLAUDE.md — RETRO ARCADE

ブラウザで遊べるレトロゲームセンター風サイト。GitHub Pages でそのまま公開する。
ここに書いたルールは、以後**すべての作業で必ず守る**こと。

## 全体のルール

- ビルド不要。素のHTML/CSS/JavaScriptのみ。外部ライブラリは使わない
- ファイルの参照はすべて相対パス（先頭が `/` のパスは禁止）
- 画面は256×240ドット相当。整数倍で拡大し、`image-rendering: pixelated` でぼかさない
- 縦持ち・横持ち・PCのどれでも、画面比率を保って中央に表示する
- 色は全体で共通の16色パレットのみ（`shared/palette.js` に定義）
- 文字はGoogle FontsのDotGothic16とPress Start 2P
- 効果音はWeb Audio APIで合成。スタート画面の最初のタップ/クリックで音声を有効化
- 入力は `pointerdown` で即時判定（`click` は使わない）。PCはキーボードにも対応
- スマホのダブルタップ拡大・長押しメニュー・スクロールをゲーム画面では無効化
- localStorageのキーは「retro-arcade:ゲーム名:項目」の形式（区分が要る場合は「retro-arcade:ゲーム名:区分:項目」）
- キャラクターや名前はすべてオリジナル
- 1ゲーム＝`games/` 配下の1フォルダ。筐体の一覧は `games.js` で管理する

## 構成

```
index.html / index.js   トップページ（1996年・大須のゲーセン「にゃらゲームプラザ」。街並み→入店→店内）
games.js                筐体の一覧（1行＝1台）
plaza/                  トップページだけの部品（名前空間 Plaza。街並み・店内・空・音）
shared/                 全ゲーム共通の部品（名前空間 RA）
  palette.js            16色パレット（RA.P.名前 で色を取る）
  base.css              画面の配置・ジェスチャー無効化
  screen.js             256×240の画面、整数倍拡大、ゲームループ
  input.js              pointerdown / キーボード入力
  text.js               ドット文字の描画、漢数字
  audio.js              Web Audioの効果音合成・音声の有効化
  ui.js                 ボタン、トップへ戻る
  store.js              localStorage（キーの形式を強制）
  weather.js            名古屋の季節と天気（RA.Weather。菌糸ライフとトップページで共通）
games/<ゲーム名>/       1ゲーム＝1フォルダ（index.html が入口）
```

## 実装の決まりごと

- 共通の処理は `shared/` に置き、ゲーム固有の処理は各ゲームのフォルダに閉じる
- 描画はすべて 256×240 の canvas に整数座標で行う。色は必ず `RA.P.名前` から取る
- パレット外の中間色を生む描画（`globalAlpha`、グラデーション、`shadowBlur`、斜めの `clip`、平滑化した拡大縮小）は使わない。
  点滅やディザで表現する
- 文字は `RA.text()` で描く（しきい値処理でにじみを消し、パレット色に揃える）。日本語は DotGothic16 の16px（またはその整数倍）、英字は Press Start 2P の8px（またはその整数倍）
- 入力は `RA.bindInput()` を使う。判定は `pointerdown` とキー入力のタイムスタンプで行う
- Web Share・クリップボードのように「ユーザー操作による有効化」が必要なAPIは、`pointerdown` で判定したうえで
  `RA.withActivation()` を通して呼ぶ（タッチの `pointerdown` はブラウザ仕様上その有効化にならないため、同じ指の `pointerup` で実行される）
- 保存は `RA.Store` を通す（キーの形式を自動で守る）
- ゲームからトップへ戻るリンクは `../../index.html`（`RA.goTop()`）
- 画像などの素材は各ゲームの `assets/` に置き、相対パスで読む
