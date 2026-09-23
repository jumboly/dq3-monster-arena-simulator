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
- **History / Statistics**: 試合履歴の再表示、勝率・収支・ROI、AI 予測の Brier Score と較正表。
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
└─ localStorage            src/storage/     API キー / 設定 / セッション / 履歴
```

- **戦闘ロジックは React から独立**しています（`src/core/` は UI・localStorage に依存しない純 TypeScript）。UI は `ArenaGame` インターフェース（`src/core/arena/ArenaGame.ts`）だけを通して格闘場を操作します。
- **AI は `BettingAgent` インターフェースで分離**しています。AI には `MatchObservation`（賭ける前に人間にも見せてよい情報）だけを渡し、乱数シード・実際の初期 HP・あやしいかげの実体などの Hidden Runtime State は渡しません。Classic / Analyst の画面表示と AI への入力は同じ関数（`buildObservation`）から作ります。
- **乱数は差し替え可能**です。エンジンは ROM の呼び出し口（`rand00FF`, `rand0toA`, `rand63to99` など）と 1 対 1 の `RomRandom` だけを使うので、将来 SFC 実機の乱数生成器（`SfcDq3Rng`）を実装したときに消費順まで合わせられます。
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

開発者向け: 実装時の Jev 挙動調査（`scripts/probe-jev.ts`）はプロジェクトルートの `.env`（`VERCEL_AI_GATEWAY_API_KEY`、git 管理外）を読みます。公開版の Web アプリはこの値を使いません。

## Battle Fidelity

再現度は 4 段階で管理しています。詳細はすべて [`docs/research/battle-spec.md`](docs/research/battle-spec.md)（戦闘）と [`docs/research/arena-spec.md`](docs/research/arena-spec.md)（窓口）に、出典のアドレスとともに記載しています。

| 区分 | 意味 |
|---|---|
| **Confirmed** | 注釈付き逆アセンブル、または ROM データダンプで確認済み |
| **Likely** | 解析者の文章や前後のコードから強く示唆されるが、該当ルーチン本体は未公開 |
| **Approximation** | 意図的な近似 |
| **Unknown** | 未解明。暫定挙動を明記して Issue 化（戦闘ごとに通過回数を `fidelityHits` に記録し、Internal ログで確認できる） |

### Confirmed（主なもの）

- 戦闘メインループの流れと、格闘場モードで分岐する箇所（PC 不在、Group 4 移動、ターン上限 10、生存者数による決着）
- ターン中の素早さ `floor((すばやさ + 20) × r / 256) + 1`（r = 0..255）と、同値時はインデックスの小さい方が先という行動順
- コマンド決定戦略 0〜2 のルーレット重み（32×8 / 18..46 / 2..14,200）、同一グループのコマンド制約、知能による MP 判定
- **格闘場使用許可 0 のコマンド（仲間呼び・にげる）は「通常攻撃に置き換わる」のではなく除外して再抽選**され、8 つすべて除外されたときだけ通常攻撃になる
- PC 側の前列補正（40/30/20/10）は格闘場では常に無効（Group 5 が存在しないため）
- 通常攻撃のダメージ式（`攻撃力 − 守備力/2` と乱数 99..153/256、低攻撃力時の 0/1）、痛恨は「痛恨の一撃」コマンドのみ 1/8、呪文・息は敵陣側ダメージ表
- 防御中はコマンドを問わずダメージ半減、メガンテ（1/2 で即死・1/2 で HP 依存ダメージ）
- 決着は 1 行動ごとに判定。生存 1 体で決着、0 体で引き分け。10 ターン目を実行し終えた後に打ち切り（賭けた選手が生存なら引き分け、既に倒れていて他が 2 体以上なら**はずれ**）
- Group 4 の影響: 回避率の分母 48 → 64、集中攻撃の記憶域 `$7E2466`、ダメージ表・打撃式は敵陣側扱い

### Likely / Approximation

- 初期 HP（最大 HP の 90〜100%）、MP 255 は減らない、複数回行動の回数分布（dqbook の記述）
- マッチメイクのレベル帯（上限値を「候補数」＝半開区間と解釈）、オッズ中間値の範囲表、賭け金
- 乱数は分布が等価な擬似乱数（mulberry32）で、SFC 実機の乱数列とは一致しない（Approximation）
- 試合 38 は Phase B まで Lv30 以上のマッチメイク候補から除外（Approximation）

## Known Differences

- **乱数列は実機と一致しません。** 分布が等価な乱数で、呼び出し口と消費順だけを ROM に合わせています。
- 試合 38（あやしいかげ）は未対応（実体決定の式は実装済み、戦闘への反映は未検証）。
- 予想屋は未実装です。
- 引き分け時の払い戻しは既定で「返金」です（実機の扱いが不明なため、設定で「没収」に切り替え可能）。

## Known Unknowns

推測で埋めず、暫定挙動で実装して Issue に残しています（[unknown ラベルの Issue 一覧](https://github.com/jumboly/dq3-monster-arena-simulator/issues?q=label%3Aunknown)、[`docs/research/unknowns.md`](docs/research/unknowns.md)）。勝率への影響が大きいものは次のとおりです。

| Issue | 内容 | 暫定挙動 |
|---|---|---|
| [#1](https://github.com/jumboly/dq3-monster-arena-simulator/issues/1) | 格闘場の対象候補生成 `$027040` | 自分と別グループの、アクティブで倒れていない者から一様に選ぶ |
| [#4](https://github.com/jumboly/dq3-monster-arena-simulator/issues/4) | 対象決定判断テーブル `$026971`（呪文を選ぶ条件） | 判断番号ごとの妥当な条件 |
| [#13](https://github.com/jumboly/dq3-monster-arena-simulator/issues/13) | 耐性ロールと状態異常の成否 `$02A3EB` / `$02A406` | 耐性 0/1/2/3 → 成功率 256/192/76/0 ÷ 256 |
| [#15](https://github.com/jumboly/dq3-monster-arena-simulator/issues/15) | 終了判定での麻痺・バシルーラの数え方 `$02B3C5` / `$02B3E8` | 「アクティブかつ倒れていない」を生存とする |
| [#3](https://github.com/jumboly/dq3-monster-arena-simulator/issues/3) | Group 4 の集中攻撃記憶 `$7E2466` の生存確認 | アクティブかつ倒れていなければ有効 |
| [#20](https://github.com/jumboly/dq3-monster-arena-simulator/issues/20) | 払い戻し式と引き分け時の返金 | 賭け金 × オッズ、引き分けは返金 |

例: 試合 29（ヘルコンドル vs テンタクルス）ではヘルコンドルのバシルーラが勝敗をほぼ決めますが、その成功率（#13 の耐性 1 の値）と、飛ばされた選手を終了判定でどう数えるか（#15）はどちらも未解明です。そのため現状のシミュレーション勝率（約 43%）は、オッズ（8 倍）の想定よりかなり高くなっています。


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
