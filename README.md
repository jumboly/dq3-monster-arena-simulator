# DQ3 Monster Arena Simulator

SFC版『ドラゴンクエストIII そして伝説へ…』のモンスター格闘場を、公開されている ROM 解析資料に基づいてできる限り忠実に再現する、**非公式の技術検証・教育目的**のシミュレーターです。人間がブラウザで遊べるほか、AI（Jev）に同じ格闘場で賭けさせ、人間と AI の賭け判断を比較できます。

> **本プロジェクトは非公式であり、株式会社スクウェア・エニックスをはじめとする権利者とは一切関係ありません。** ROM・ROM 断片・画像・音声などの著作物は含みません。

## Demo

**Live Demo: https://www.jumboly.jp/dq3-monster-arena-simulator/**

## Overview

- 目的は「DQ3 風の戦闘」を作ることではなく、公開解析情報に基づいて SFC 版の格闘場を再現し、その上で人間と AI の賭け判断を検証することです。
- 仕様ごとに再現度を **Confirmed / Likely / Approximation / Unknown** で区別しています。Unknown は推測で補完せず、暫定挙動を明記して [GitHub Issues](https://github.com/jumboly/dq3-monster-arena-simulator/issues?q=label%3Aunknown) に残しています。
- 完全な静的サイトです（バックエンドなし）。GitHub Pages で配信し、状態はブラウザの localStorage に保存します。

## Features

- **格闘場の再現**: 全 38 試合カードのデータ、主人公レベル帯によるマッチメイク、オッズの乱数補正、賭け金（主人公 Lv × 10G）、払い戻し。試合 1〜37 がプレイ可能（試合 38「あやしいかげ ×3」は Phase B）。
- **戦闘エンジン**: SFC 版の戦闘メインループ（`$0259F5`）に沿った `DQ3BattleEngine` + 格闘場モード。ターン中の素早さ、行動決定ルーレット、知能（コマンド選択判断）、複数回行動、集中攻撃、Group 4（賭けた選手）の分岐、ダメージ式、1 行動ごとの決着判定、10 ターン制限。
- **Human モード**: BET → 即結果 → 次の試合、というテンポ重視の進行。Classic（名前とオッズだけ）/ Analyst（能力値・行動と選択率・AI・耐性・特性）の 2 つの情報モード。
- **Jev モード**: Vercel AI Gateway 経由で Jev に勝者予測を問い合わせ、確率と賭け先を表示してから戦闘。Auto Play（10 / 100 / 1000 試合、確認・上限・Stop 付き）。
- **Battle Log**: Simple / Detail（計算根拠）/ Internal（コマンド ID・対象・乱数）の 3 層。ターン単位の Replay。
- **冒険の書**: セッションを「冒険の書」として何冊でも残し、切り替えて遊べます（つくる / うつす / けす / なまえを かえる）。「同じ試合順で はじめから」うつすと seed を引き継ぐので、同じ試合列で Jev の設定や情報モードを比べられます。
- **History / Statistics**: 試合履歴の再表示、勝率・収支・ROI、AI 予測の Brier Score と較正表、冒険の書どうしの比較表。JSON エクスポートは 1 冊単位とすべての冊の 2 種類。
- **Analysis（Monte Carlo）**: 通常ゲームとは別画面で、カードと賭け先ごとに `P(Winner=i | Match, Bet=j)` を多数回シミュレーションで推定。
- **再現性**: 戦闘はシード付き乱数で決定的に再生でき、ゴールデンテストで固定しています。

## Architecture

```text
Browser (GitHub Pages, no backend)
├─ UI (React)              src/ui/          画面。ArenaGame と BettingAgent だけを呼ぶ
├─ Arena Core              src/core/arena/  マッチメイク・オッズ・賭け金・払い戻し・観測（公開情報）
│   └─ Battle Engine       src/core/battle/ DQ3BattleEngine（共通メインループ + ArenaMode）
│       └─ RNG             src/core/rng/    RandomSource / RomRandom（ROM の乱数呼び出し口と 1 対 1）
├─ Data                    src/core/data/   vendor/dqbook の表から生成した JSON のローダ
├─ AI Player               src/ai/          BettingAgent ← JevBettingAgent → VercelGatewayClient → Jev
├─ Stats                   src/core/stats/  収支・Brier Score・勝率分布（純関数）
└─ localStorage            src/storage/     API キー / 設定 / 冒険の書（sessions）/ 冊ごとの履歴（history.<id>）
```

- **戦闘ロジックは React から独立**しています（`src/core/` は UI・localStorage に依存しない純 TypeScript）。UI は `ArenaGame` インターフェース（`src/core/arena/ArenaGame.ts`）だけを通して格闘場を操作します。
- **AI は `BettingAgent` インターフェースで分離**しています。AI には `MatchObservation`（賭ける前に人間にも見せてよい情報）だけを渡し、乱数シード・実際の初期 HP・あやしいかげの実体などの Hidden Runtime State は渡しません。Classic / Analyst の画面表示と AI への入力は同じ関数（`buildObservation`）から作ります。
- **乱数は差し替え可能**です。エンジンは ROM の呼び出し口（`rand00FF`, `rand0toA`, `rand63to99` など）と 1 対 1 の `RomRandom` だけを使うので、将来 SFC 実機の乱数生成器（`SfcDq3Rng`）を実装したときに消費順まで合わせられます。
- **保存容量**: localStorage は概ね 5M 文字です。Battle Log（1 試合 約 15KB）は遊んでいる冒険の書の直近 30 試合だけ保持し、他の冊は要約（約 0.8KB）だけ残します。ログは battleSeed から再生成できます。冒険の書導入前の単一セッションは、初回起動時に「冒険の書 1」へ自動で移行します。
- 賭けた選手（Group 4）が戦闘処理の分岐を変えるため、勝率は `P(Winner=i | Match, Bet=j)` として扱います（例: 賭けると回避率の分母が 48 → 64 になる）。

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

開発者向け: Jev と Monte Carlo の比較スクリプト（`scripts/compare-jev-mc.ts`）はプロジェクトルートの `.env`（`VERCEL_AI_GATEWAY_API_KEY`、git 管理外）を読みます。公開版の Web アプリはこの値を使いません。

## Battle Fidelity

再現度は 4 段階で管理しています。詳細はすべて [`docs/research/battle-spec.md`](docs/research/battle-spec.md)（戦闘）と [`docs/research/arena-spec.md`](docs/research/arena-spec.md)（窓口）に、出典のアドレスとともに記載しています。

| 区分 | 意味 |
|---|---|
| **Confirmed** | 注釈付き逆アセンブル、または ROM データダンプで確認済み |
| **Likely** | 解析者の文章や前後のコードから強く示唆されるが、該当ルーチン本体は未公開 |
| **Approximation** | 意図的な近似 |
| **Unknown** | ROM 上の処理が未公開。公開資料と実測で方針を決めた（[`fidelity-review.md`](docs/research/fidelity-review.md)）。近似した分岐の通過回数は戦闘ごとに `fidelityHits` に記録し、Internal ログで確認できる |

### Confirmed（主なもの）

- 戦闘メインループと格闘場モードの分岐（PC 不在、Group 4 移動、ターン上限 10、生存者数による決着）、行動順、コマンド決定のルーレット重み
- **格闘場使用許可 0 のコマンド（仲間呼び・にげる）は通常攻撃に置き換わるのではなく、除外して再抽選**される
- 通常攻撃・呪文・息のダメージ式、防御、メガンテ、Group 4 の影響（回避率の分母・集中攻撃・ダメージ表）

一覧と出典アドレスは [`battle-spec.md`](docs/research/battle-spec.md) を参照してください。

### Likely / Approximation

- 初期 HP（最大 HP の 90〜100%）、MP 255 は減らない、複数回行動の回数分布（dqbook の記述）
- マッチメイクのレベル帯（上限値を「候補数」＝半開区間と解釈）、オッズ中間値の範囲表、賭け金
- 乱数は分布が等価な擬似乱数（mulberry32）で、SFC 実機の乱数列とは一致しない（Approximation）
- 試合 38 は Phase B まで Lv30 以上のマッチメイク候補から除外（Approximation）

## Known Differences

- **乱数列は実機と一致しません。** 分布が等価な乱数で、呼び出し口と消費順だけを ROM に合わせています。
- 試合 38（あやしいかげ）は未対応（実体決定の式は実装済み、戦闘への反映は未検証）。
- 予想屋は未実装です。
- 引き分け時の払い戻しは、賭けた選手が生き残った引き分けだけ返金します（攻略サイトの記述による。設定で「常に没収」に切り替え可能）。

## Known Unknowns

ROM の処理が未公開の項目（`U-01`〜`U-22`。コード・仕様書の `U-xx` は Issue #xx に対応）は、ROM 解析をせず、公開資料と実測にもとづいて方針を決めています。判定・根拠・別解釈をとった場合の勝率への影響は [`docs/research/fidelity-review.md`](docs/research/fidelity-review.md) にまとめています。

公開資料では決めきれず、暫定方針のまま確定扱いにしている項目もあります。影響が大きいのは、決着判定でマヒした選手を数えるか（試合 25 で 5〜6pt）、あまいいき・やけつくいきのモンスター相手の成功率（試合 32 で最大 25pt）、回復・ルカナンを選ぶ条件（4〜10pt）です。これらが絡む試合のシミュレーション勝率は、数ポイントずれている可能性があります。

## Sources

仕様ごとの出典は [`docs/research/battle-spec.md`](docs/research/battle-spec.md) §0.2・[`docs/research/arena-spec.md`](docs/research/arena-spec.md) の各節に、アドレス単位で記載しています。

- [showa-yojyo/dqbook](https://github.com/showa-yojyo/dqbook)（プレハブ小屋『ドラクエ解析本』）: 構造体定義とデータ表（モンスター・コマンド・ダメージ・マッチメイク）、格闘場の概要。`vendor/dqbook/` にコミットを固定して同梱しています（[`SOURCE.md`](vendor/dqbook/SOURCE.md)、MIT License）。
- [RetroGameHackers「DQ3戦闘部分解説」シリーズ](https://retrogamehackers.net/dq3-battlesystem-001/)（`-001` 〜 `-026`、補遺 `-011-2` 〜 `-011-4`）と改造記事・[小ネタ集](https://retrogamehackers.net/dq3-trivia/): 戦闘メインループ、行動決定、ターゲット、ダメージ式、終了判定、耐性。記事は転載せず、`scripts/fetch-research.sh` で `-001` 〜 `-026` をローカルに取得できます。

## Acknowledgements

このシミュレーターは、長年にわたって SFC 版ドラゴンクエストIII を解析し、その成果を公開してくださった方々の仕事がなければ成り立ちません。心より感謝します。

- **プレハブ小屋（showa-yojyo）** さん — 『ドラクエ解析本』（dqbook）。モンスター・コマンド・戦闘員・ダメージの構造体定義と、格闘場を含むデータ表を MIT License で公開してくださっています。本プロジェクトのゲームデータはすべてここから機械的に変換しています。
- **レトロゲームハッカーズ（RetroGameHackers）** さん — 「DQ3戦闘部分解説」シリーズ。戦闘メインループから行動決定・ターゲット・ダメージ・終了判定までの注釈付き逆アセンブルにより、格闘場戦闘の大部分を Confirmed として実装できました。

## License

- ソースコード: [MIT License](LICENSE)
- `vendor/dqbook/`: MIT License（Copyright (c) 2002, 2014 プレハブ小屋。[`vendor/dqbook/LICENSE`](vendor/dqbook/LICENSE)）
- 『ドラゴンクエストIII』に関する権利は権利者に帰属します。本リポジトリは ROM・画像・音声を含まず、シミュレーターの成立に必要な最小限のテキストデータ（モンスター名・コマンド名・数値表）のみを解析資料から生成して使用しています。
