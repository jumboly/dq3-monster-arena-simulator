# DQ3 Monster Arena Simulator

SFC版『ドラゴンクエストIII そして伝説へ…』のモンスター格闘場を、公開されている ROM 解析資料に基づいてできる限り忠実に再現する、**非公式の技術検証・教育目的**のシミュレーターです。人間がブラウザで遊べるほか、AI（Jev）に同じ格闘場で賭けさせ、人間と AI の賭け判断を比較できます。

> **本プロジェクトは非公式であり、株式会社スクウェア・エニックスをはじめとする権利者とは一切関係ありません。** ROM・ROM 断片・画像・音声などの著作物は含みません。

## Demo

**Live Demo: https://www.jumboly.jp/dq3-monster-arena-simulator/**

## Overview

- 目的は「DQ3 風の戦闘」を作ることではなく、公開解析情報に基づいて SFC 版の格闘場を再現し、その上で人間と AI の賭け判断を検証することです。
- 仕様ごとに再現度を **Confirmed / Likely / Approximation / Unknown** で区別しています。Unknown は推測で補完せず、暫定挙動を明記して [GitHub Issues](https://github.com/jumboly/dq3-monster-arena-simulator/issues?q=label%3Aunknown) に残しています。
- 完全な静的サイトです（バックエンドなし）。GitHub Pages で配信し、状態はブラウザの localStorage に保存します。

<!-- FEATURES -->

<!-- ARCHITECTURE -->

## How to Run

Node.js 22 以上が必要です。

```sh
npm install
npm run dev        # データ生成 → 開発サーバー起動
npm test           # データ生成 → 全テスト
```

`npm run data` が `vendor/dqbook/` の解析データ表から `src/data/generated/game-data.json` を生成します（`dev` / `build` / `test` の前に自動で実行されます）。生成物は git 管理外です。

## How to Build

```sh
npm run build      # dist/ に静的ファイルを出力
npm run preview
```

GitHub Pages 用のサブパス（`/dq3-monster-arena-simulator/`）で出力するときは `GITHUB_PAGES=true npm run build` とします。

## How to Deploy

`main` ブランチへの push で GitHub Actions（`.github/workflows/pages.yml`）がテスト → ビルド → GitHub Pages へのデプロイを行います。テストが失敗した版は公開されません。

## AI Settings

Player Mode を **Jev** にすると、試合ごとに Jev（TypeSafe AI の評価モデル `typesafe-ai/jev`）へ勝者予測を問い合わせ、その予測に基づいて賭けます。

1. [Vercel](https://vercel.com/) のダッシュボードで AI Gateway の API キーを発行します。
2. 画面上部の「設定」タブで **Vercel AI Gateway API Key** に貼り付け、Save します。
3. 開始画面で Player Mode = Jev を選び、試合画面で **Ask Jev** → 予測表示 → **Fight**。
4. **Auto Play** で 10 / 100 / 1000 試合を連続実行できます（開始前に API 呼び出し回数の目安を確認し、いつでも Stop できます）。

呼び出しはブラウザから `POST https://ai-gateway.vercel.sh/v1/evaluate` へ直接行います。Jev は文章を生成せず、選択肢ごとの確率だけを返す評価モデルです。そのため画面の「Reason」は Jev の確率から機械的に組み立てた説明で、Jev が書いた文章ではありません。詳細は [`docs/research/jev-probe.md`](docs/research/jev-probe.md)。

## API Key Security

**このツールは、利用者自身の API キーをブラウザの localStorage に保存します。**

- キーはその利用者のブラウザの localStorage（キー名 `dq3arena.aiGatewayApiKey`）にのみ保存され、Vercel AI Gateway 以外へは送信されません。
- キーはリポジトリ・ビルド成果物・Battle Log・エクスポートデータ・Jev への入力（state）に含まれず、console やエラーメッセージにも出力しません（テストで確認しています）。
- localStorage は同じブラウザを使う人や、同じオリジンで動くスクリプトから読める場所です。**共用 PC・公開 PC では使わないでください。** 使い終わったら設定画面の Clear で削除できます。
- できるだけ **このツール専用の、利用上限（予算）を設定したキー** を使ってください。

開発者向け: 実装時の Jev 挙動調査（`scripts/probe-jev.ts`）はプロジェクトルートの `.env`（`VERCEL_AI_GATEWAY_API_KEY`、git 管理外）を読みます。公開版の Web アプリはこの値を使いません。

<!-- FIDELITY -->

## Sources

仕様ごとの出典は [`docs/research/battle-spec.md`](docs/research/battle-spec.md)・[`docs/research/arena-spec.md`](docs/research/arena-spec.md) の各節に、アドレス単位で記載しています。

| 資料 | URL | 主に確認した仕様 |
|---|---|---|
| showa-yojyo/dqbook（プレハブ小屋『ドラクエ解析本』） | https://github.com/showa-yojyo/dqbook / https://showa-yojyo.github.io/dqbook/dq3.html | 構造体定義（モンスター・コマンド・戦闘員・ダメージ）、格闘場の概要 |
| dq3_C30DC5_matchmake.txt（マッチメイク表） | https://github.com/showa-yojyo/dqbook/blob/master/src/jp/book/data/dq3_C30DC5_matchmake.txt | 38 試合の出場モンスターとオッズ属性値 |
| dq3_C20000_monsters.txt（モンスター表） | https://github.com/showa-yojyo/dqbook/blob/master/src/jp/book/data/dq3_C20000_monsters.txt | 能力値・コマンド・AI・耐性 |
| dq3_C21860_commands.txt（コマンド表） | https://github.com/showa-yojyo/dqbook/blob/master/src/jp/book/data/dq3_C21860_commands.txt | 格闘場使用許可フラグ、対象範囲、ダメージ ID |
| dq3_C23BB4_damage.txt（ダメージ表） | https://github.com/showa-yojyo/dqbook/blob/master/src/jp/book/data/dq3_C23BB4_damage.txt | 呪文・息・回復の基本値 |
| dqbook: 格闘場 | https://showa-yojyo.github.io/dqbook/dq3_matchmake.html | レベル帯とカード範囲、オッズ計算、賭け金 |
| RetroGameHackers「DQ3戦闘部分解説」シリーズ（1〜23 と補遺） | https://retrogamehackers.net/dq3-battlesystem-002/ ほか（`-001` 〜 `-026`、`-011-2` 〜 `-011-4`） | 戦闘メインループ、行動順、行動決定、ターゲット、ダメージ式、終了判定、Group 4 |
| RetroGameHackers「DQ3 戦闘行動の属性IDと耐性」 | https://retrogamehackers.net/dq3-battlesystem-025/ | 系統分類と耐性の対応 |
| RetroGameHackers 改造記事（耐性・毒・スクルト） | https://retrogamehackers.net/dq3-battlesystem-mod-011/ ほか（mod-016, mod-027, mod-028） | 耐性が確率であること、戦闘中の毒ダメージがないこと、守備力上限 |
| RetroGameHackers「オリジナルSFC版DQ3小ネタ集」 | https://retrogamehackers.net/dq3-trivia/ | あやしいかげの実体候補 |

- `vendor/dqbook/` に dqbook のデータ表と解説（MIT License）を、コミットを固定して同梱しています（[`vendor/dqbook/SOURCE.md`](vendor/dqbook/SOURCE.md)）。
- RetroGameHackers の記事はリポジトリに転載していません（`scripts/fetch-research.sh` でローカルに取得できます）。

## Acknowledgements

このシミュレーターは、長年にわたって SFC 版ドラゴンクエストIII を解析し、その成果を公開してくださった方々の仕事がなければ成り立ちません。心より感謝します。

- **プレハブ小屋（showa-yojyo）** さん — 『ドラクエ解析本』（dqbook）。モンスター・コマンド・戦闘員・ダメージの構造体定義と、格闘場を含むデータ表を MIT License で公開してくださっています。本プロジェクトのゲームデータはすべてここから機械的に変換しています。
- **レトロゲームハッカーズ（RetroGameHackers）** さん — 「DQ3戦闘部分解説」シリーズ。戦闘メインループから行動決定・ターゲット・ダメージ・終了判定までの注釈付き逆アセンブルにより、格闘場戦闘の大部分を Confirmed として実装できました。

## License

- ソースコード: [MIT License](LICENSE)
- `vendor/dqbook/`: MIT License（Copyright (c) 2002, 2014 プレハブ小屋。[`vendor/dqbook/LICENSE`](vendor/dqbook/LICENSE)）
- 『ドラゴンクエストIII』に関する権利は権利者に帰属します。本リポジトリは ROM・画像・音声を含まず、シミュレーターの成立に必要な最小限のテキストデータ（モンスター名・コマンド名・数値表）のみを解析資料から生成して使用しています。
