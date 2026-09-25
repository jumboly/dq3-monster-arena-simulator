/**
 * SFC 版 DQ3 戦闘エンジン（格闘場モード）。
 *
 * 設計方針:
 * - SFC 版は通常戦・イベント戦・格闘場が同一のメインループ $0259F5 を共有する（battle-spec §1.1, Confirmed）。
 *   ここでは格闘場モードだけを実装し、通常戦との差分箇所（§1.2 の表）は格闘場側の挙動に固定してコメントで示す。
 * - 仕様書の Confirmed / Likely はその通りに、Unknown は仕様書の「暫定挙動」を採り、分岐を通るたびに
 *   fidelityHits['U-xx'] を加算する。仕様に無いことは補完しない（補完が避けられない所はコメントで明示）。
 * - 乱数は RomRandom（ROM の呼び出し口と 1 対 1）経由でのみ引き、消費順を §9 に合わせる。
 */
import {
  getCommand as defaultGetCommand,
  getDamage as defaultGetDamage,
  getMonster as defaultGetMonster,
  NORMAL_ATTACK_COMMAND_ID,
} from '../data/gameData'
import type { CommandDef, DamageDef, MonsterDef } from '../data/types'
import type { RandomSource } from '../rng/RandomSource'
import { formatRomTrace, RomRandom } from '../rng/RomRandom'
import {
  actionCountFromAttr,
  criticalDamage,
  EMPTY_COMMAND_ID,
  evasionParams,
  meganteDamage,
  normalAttackDamage,
  RESISTANCE_P256,
  resistanceIndexForCategory,
  rouletteIndex,
  sortActionOrder,
  TARGET_ALL_ENEMIES,
  TARGET_EMPTY,
  TARGET_GROUP_FLAG,
  turnAgilityFromRoll,
} from './formulas'
import type {
  ArenaBattleSetup,
  ArenaEndType,
  BattleEngine,
  BattleLogEntry,
  BattleOutcome,
  BattleResult,
  CombatantState,
  GroupId,
} from './types'

/** 格闘場のターン上限（$02A48C, battle-spec §8.3, Confirmed）。通常戦は 65535 */
const ARENA_TURN_LIMIT = 10
/** 戦闘員の最大数（インデックス 0..23） */
const MAX_COMBATANTS = 24
/** MP 属性 255 は「MP が減らない」マジックナンバー（battle-spec §2.2, Likely） */
const INFINITE_MP = 65535
/** あやしいかげ（battle-spec §2.4） */
const SHADOW_MONSTER_ID = 0x19
/** 眠りの n 回目の覚醒判定の分母（1/8, 1/3, 1/2, 1/1） */
const SLEEP_WAKE_DENOMS = [8, 3, 2, 1] as const
/** 守備力の上限（$0299F5, battle-spec §7.5, Confirmed） */
const DEFENSE_CAP = 1023
/** ダメージ構造体の「全快」マジックナンバー（battle-spec §7.3, Confirmed） */
const DAMAGE_FULL = 1023

/** コマンド ID（dqbook の 16 進表記との対応をコメントに残す） */
const CMD = {
  attack: 0x01,
  critical: 0x02,
  sleepAttack: 0x03,
  poisonAttack: 0x04,
  paralyzeAttack: 0x05,
  megante: 0x1a,
  defend: 0x68,
} as const

/** 戦闘員の実行時データ（契約の CombatantState に、エンジン内部だけで使う値を添えたもの） */
interface Fighter {
  s: CombatantState
  /** ステータス・行動パターンの出どころ（あやしいかげは実体: U-10） */
  def: MonsterDef
  /** 素の守備力・すばやさ（ルカナン等の暫定量 U-14 と、補正量表示のため） */
  baseDefense: number
  baseAgility: number
  /** マホトラで奪った MP の頭打ち（U-14） */
  maxMp: number
  /** 行動枠 3 つ（$242A/$2430/$2470 相当）。未使用は空コマンド #$A4 */
  actions: PlannedAction[]
  /** 神（知能 2）がターン開始時に決めておく行動回数（U-05） */
  pendingActionCount: number
}

interface PlannedAction {
  cmd: number
  /** 行動対象エンコード（battle-spec §5.1） */
  target: number
  /** コマンド番号 0..7。失敗時フォールバックは 8 */
  index: number
}

const emptyAction = (): PlannedAction => ({ cmd: EMPTY_COMMAND_ID, target: TARGET_EMPTY, index: 8 })

/** データ参照の差し替え口。単体テストで架空のモンスター・コマンドを差し込むため */
export interface DQ3BattleEngineOptions {
  getMonster?: (id: number) => MonsterDef
  getCommand?: (id: number) => CommandDef
  getDamage?: (id: number) => DamageDef
  /**
   * 初期化（Group 4 移動まで）直後に戦闘員状態を書き換えるフック。
   * 眠り・マヒなどの状態を仕込んだ単体テストのためのもので、通常の利用では指定しない。
   */
  prepareCombatants?: (states: CombatantState[]) => void
}

interface DataAccess {
  monster: (id: number) => MonsterDef
  command: (id: number) => CommandDef
  damage: (id: number) => DamageDef
  prepare?: (states: CombatantState[]) => void
}

export class DQ3BattleEngine implements BattleEngine {
  private readonly data: DataAccess

  constructor(options: DQ3BattleEngineOptions = {}) {
    this.data = {
      monster: options.getMonster ?? defaultGetMonster,
      command: options.getCommand ?? defaultGetCommand,
      damage: options.getDamage ?? defaultGetDamage,
      prepare: options.prepareCombatants,
    }
  }

  runArena(setup: ArenaBattleSetup, rng: RandomSource): BattleResult {
    return new BattleRun(this.data, setup, rng).run()
  }
}

/** 判断ルーチンの結果（c=off なら ok=true と対象） */
type Judgment = { ok: true; target: number } | { ok: false }

/** 実行ハンドラの種別。コマンドの「処理アドレス（戦闘）」で振り分ける */
type HandlerKind =
  | 'attack'
  | 'spell-damage'
  | 'zaki'
  | 'megante'
  | 'basiruura'
  | 'mahotora'
  | 'bomios'
  | 'heal'
  | 'sleep'
  | 'mahoton'
  | 'manusa'
  | 'rukanan'
  | 'sukuruto'
  | 'medapani'
  | 'poison-breath'
  | 'paralyze-breath'
  | 'odori'
  | 'defend'
  | 'nothing'

/**
 * 処理アドレス → ハンドラ。dqbook-data:commands の battleHandler 列（$C2xxxx 表記）。
 * ここに無い処理アドレスのコマンドは未実装として扱う（例外にせず fidelityHits と note ログ）。
 */
const HANDLERS: Record<string, HandlerKind> = {
  C28DA9: 'attack', // 通常攻撃・痛恨・眠り/毒/マヒ攻撃（§7.1, §6.6, §7.6）
  C28E66: 'spell-damage', // 攻撃呪文・息（§7.3）
  C29324: 'zaki', // ザキ/ザラキ（§7.4）
  C293E0: 'megante', // メガンテ（§6.9）
  C2948D: 'basiruura', // バシルーラ（§6.10）
  C29548: 'mahotora', // マホトラ（§7.5）
  C295CB: 'bomios', // ボミオス（§7.5）
  C29610: 'heal', // ホイミ系（§7.5）
  C297DB: 'sleep', // ラリホー・あまいいき（§7.4）
  C2984E: 'mahoton',
  C298B6: 'manusa',
  C2991B: 'rukanan',
  C29A23: 'sukuruto',
  C29AB7: 'medapani',
  C29DB3: 'poison-breath', // どくのいき（§7.4 暫定）
  C29DDE: 'paralyze-breath', // やけつくいき（§7.4 暫定）
  C29E08: 'odori', // ふしぎなおどり（§6.10）
  C29F4A: 'defend', // ぼうぎょ（§6.8）
  C28DA7: 'nothing', // 様子を見る等の共通空処理（§6.8, Likely）
}

const hex2 = (n: number): string => '0x' + n.toString(16).toUpperCase().padStart(2, '0')
/** 表示名から dqbook の便宜括弧（（ひのいき）等）を外す */
const displayCommandName = (c: CommandDef): string => c.name.replace(/^（(.*)）$/, '$1')

class BattleRun {
  private readonly rng: RomRandom
  private readonly fighters: (Fighter | undefined)[] = new Array(MAX_COMBATANTS).fill(undefined)
  private readonly log: BattleLogEntry[] = []
  private readonly hits: Record<string, number> = {}
  /** $2462-$2466 集中攻撃ターゲット記憶（Group 0..4）。$FF = 未設定（battle-spec §5.4, Confirmed） */
  private readonly concentration: number[] = [0xff, 0xff, 0xff, 0xff, 0xff]
  /** $23B0-$23B7 グループ別「連発不可コマンド使用済み」ビット（battle-spec §4.3） */
  private readonly usedConstrained: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  /** $7E23AB 下位 4bit 戦闘終了タイプ */
  private endType = 0
  /** $23D0 経過ターン数 */
  private elapsedTurns = 0
  /** ログ用の現在ターン（1 始まり。戦闘開始前は 0） */
  private turn = 0
  /** 手番順（$0263A2 → $025DAC） */
  private order: number[] = []
  private readonly data: DataAccess
  private readonly setup: ArenaBattleSetup

  constructor(data: DataAccess, setup: ArenaBattleSetup, rng: RandomSource) {
    this.data = data
    this.setup = setup
    this.rng = new RomRandom(rng)
  }

  // ─────────────────────────────── 共通ユーティリティ ───────────────────────────────

  private hit(key: string): void {
    this.hits[key] = (this.hits[key] ?? 0) + 1
  }

  private push(entry: BattleLogEntry): void {
    // そのイベントまでに引いた乱数を Internal に添える。消費順の検証と、同じ地点からの再生のため
    const trace = this.rng.drainTrace()
    if (trace.length > 0) entry.internal = { ...(entry.internal ?? {}), rng: formatRomTrace(trace) }
    this.log.push(entry)
    // 撃破の経路（通常ダメージ・ザキ・メガンテ等）が複数あるので、正体の差し替えはここで一括して行う
    if (entry.kind === 'defeat') for (const slot of entry.targetSlots ?? []) this.revealEntity(slot)
  }

  /**
   * $02BAE8 撃破時にあやしいかげの表示名を正体に差し替える（battle-spec §2.4）。
   * 撃破メッセージ自体は差し替え前の名前で出し、以降のログから正体の名前になる。
   * 生き残った選手は撃破されないので、決着時も「あやしいかげ」のまま（差し替えは撃破時しか資料に無い）。
   */
  private revealEntity(slot: number): void {
    const f = this.all.find((x) => x.s.slot === slot)
    if (!f || f.s.monsterId === f.s.transformMonsterId) return
    // 同名表記の添字は残す。正体が別々でも、ログ上でどのスロットの選手かを追えるようにするため
    const suffix = f.s.name.slice(this.data.monster(f.s.monsterId).name.length)
    const revealed = f.def.name + suffix
    if (revealed === f.s.name) return
    this.log.push({
      turn: this.turn,
      kind: 'note',
      targetSlots: [slot],
      // 実機の文言ではなく、表示名が変わったことを示す注記（実機は以降の表示が変わるだけ）
      simple: `（${f.s.name}の しょうたい: ${f.def.name}）`,
      internal: { reveal: true, entity: hex2(f.s.transformMonsterId) },
    })
    f.s.name = revealed
  }

  private get all(): Fighter[] {
    return this.fighters.filter((f): f is Fighter => f !== undefined)
  }

  /** U-15 / U-01 暫定の「生存」= アクティブ かつ 死亡でない（マヒ・眠り・混乱は生存に数える） */
  private isAlive(f: Fighter): boolean {
    return f.s.active && !f.s.dead
  }

  private nm(f: Fighter): string {
    return f.s.name
  }

  private maskOf(list: Fighter[]): number {
    let m = 0
    for (const f of list) m |= 1 << f.s.combatantIndex
    return m
  }

  /**
   * U-01 暫定: 対象分類 3（反対陣営）の候補 = 自分と異なるグループ ID の生存者。
   * Group 4 を特別扱いしない。
   */
  private opponents(actor: Fighter): Fighter[] {
    this.hit('U-01')
    return this.all.filter((f) => f.s.groupId !== actor.s.groupId && this.isAlive(f))
  }

  /** U-01 暫定: 対象分類 1/2 は自グループ（格闘場では 1 グループ 1 体なので実質自分） */
  private ownGroup(actor: Fighter): Fighter[] {
    this.hit('U-01')
    return this.all.filter((f) => f.s.groupId === actor.s.groupId && this.isAlive(f))
  }

  private groupMembers(g: number): Fighter[] {
    return this.all.filter((f) => f.s.groupId === g && this.isAlive(f))
  }

  private pickFrom(list: Fighter[]): Fighter | null {
    const idx = this.rng.pickRandomBit(this.maskOf(list))
    return idx === null ? null : (this.fighters[idx] ?? null)
  }

  // ─────────────────────────────── メインループ $0259F5 ───────────────────────────────

  run(): BattleResult {
    this.initBattle()
    let turnLimitReached = false
    // $025A56 直後の決着判定（battle-spec §1.1）
    if (!this.checkBattleEnd()) {
      for (;;) {
        this.turn = this.elapsedTurns + 1
        this.turnStart()
        // partyCommandInput $025DEE: 格闘場では PC が居ないので何もしない（Likely）
        if (this.checkBattleEnd()) break
        this.decideTurnAgility()
        this.decideMonsterActions()
        this.fixActionOrder()
        if (this.executeOneTurn()) break
        if (this.checkTurnLimit()) {
          turnLimitReached = true
          break
        }
      }
    }
    const outcome = this.buildOutcome(turnLimitReached)
    this.push({
      turn: this.turn,
      kind: 'battle-end',
      simple: this.outcomeText(outcome),
      internal: { endType: this.endType, outcome: outcome.kind, elapsedTurns: this.elapsedTurns },
    })
    return {
      outcome,
      turns: outcome.turn,
      log: this.log,
      finalStates: this.all.map((f) => ({ ...f.s })).sort((a, b) => a.slot - b.slot),
      fidelityHits: { ...this.hits },
      rngCalls: this.rng.callCount,
    }
  }

  // ─────────────────────────────── 初期化 §2 ───────────────────────────────

  private initBattle(): void {
    const { monsterIds } = this.setup
    if (monsterIds.length < 1 || monsterIds.length > 4) {
      throw new RangeError(`格闘場の出場数は 1..4（got ${monsterIds.length}）`)
    }
    const bet = this.setup.betSlot
    if (bet !== null && (!Number.isInteger(bet) || bet < 0 || bet >= monsterIds.length)) {
      throw new RangeError(`betSlot ${bet} は出場スロット 0..${monsterIds.length - 1} の範囲外`)
    }
    // 同名表記（A/B/C）: §2.5 Unknown（表示専用）。暫定: 同 ID の出現順に 0,1,2…
    const countById = new Map<number, number>()
    for (const id of monsterIds) countById.set(id, (countById.get(id) ?? 0) + 1)
    const seenById = new Map<number, number>()

    // $025A78 PC 側戦闘員の登録は格闘場なら丸ごとスキップ（§1.2 #1, Confirmed）→ 何もしない
    // $025AC7: slot k → group k、出現数 1（§2.1, Likely）
    for (let slot = 0; slot < monsterIds.length; slot++) {
      const id = monsterIds[slot]
      let entityId = id
      if (id === SHADOW_MONSTER_ID) entityId = this.decideShadowEntity()
      const dup = seenById.get(id) ?? 0
      seenById.set(id, dup + 1)
      const suffix = (countById.get(id) ?? 0) >= 2 ? String.fromCharCode(0x41 + dup) : ''
      this.addCombatant(slot, id, entityId, dup, suffix)
    }

    // $025B8B → $025C61 賭けた選手を Group 4 へ（§2.3, Confirmed）
    if (bet === null) {
      // P-10: 賭けなし観戦は SFC に存在しない。Group 4 なしで走らせる
      this.hit('no-bet-mode')
    } else {
      for (let x = MAX_COMBATANTS - 1; x >= 0; x--) {
        const f = this.fighters[x]
        if (f && f.s.active && f.s.groupId === bet) {
          f.s.groupId = 4
          f.s.isBetTarget = true
        }
      }
    }

    this.data.prepare?.(this.all.map((f) => f.s))

    const names = this.all.map((f) => this.nm(f)).join('、')
    this.push({
      turn: 0,
      kind: 'battle-start',
      simple: `${names}の たたかいが はじまった！`,
      detail: Object.fromEntries(
        this.all.map((f) => [
          `slot${f.s.slot}`,
          `HP${f.s.hp}/${f.s.maxHp} MP${f.s.mp} 攻${f.s.attack} 守${f.s.defense} 速${f.s.agility}`,
        ]),
      ),
      internal: {
        mode: 'arena',
        betSlot: bet === null ? 'null' : bet,
        // あやしいかげの実体は Hidden。Simple には出さず Internal だけに残す（§2.4）
        ...Object.fromEntries(
          this.all.map((f) => [
            `idx${f.s.combatantIndex}`,
            `slot${f.s.slot} group${f.s.groupId} id${hex2(f.s.monsterId)} entity${hex2(f.s.transformMonsterId)}`,
          ]),
        ),
      },
    })
  }

  /** $025B46 あやしいかげの実体決定（battle-spec §2.4, Confirmed） */
  private decideShadowEntity(): number {
    const leader = this.setup.leaderLevel ?? this.setup.heroLevel
    const L = leader + 1
    const buf: number[] = []
    for (let id = 0x83; id >= 0x01; id--) {
      if (this.data.monster(id).level < L) buf.push(id)
    }
    if (buf.length === 0) throw new RangeError(`隊列先頭レベル ${leader} ではあやしいかげの実体候補が無い`)
    return buf[this.rng.rand0toA(buf.length - 1)]
  }

  /** $02AB00 戦闘員追加 */
  private addCombatant(slot: number, selfId: number, entityId: number, dup: number, suffix: string): void {
    // U-22 暫定: 戦闘員インデックスは出場順 slot 0..3 → インデックス 0..3
    this.hit('U-22')
    const index = slot
    const self = this.data.monster(selfId)
    // U-10 暫定: 戦闘に関わる全属性を実体から取る。名前表示のみ「あやしいかげ」
    if (selfId !== entityId) this.hit('U-10')
    const def = this.data.monster(entityId)
    // U-09 暫定: hp = maxHp - rand0toA(floor(maxHp/10))（格闘場も通常戦と同じ 90〜100%）
    this.hit('U-09')
    const hp = def.maxHp - this.rng.rand0toA(Math.floor(def.maxHp / 10))
    // §2.2: MP 属性 255 → 65535（減らない, Likely）
    const mp = def.mp === 255 ? INFINITE_MP : def.mp
    const group = slot as GroupId
    const s: CombatantState = {
      slot,
      combatantIndex: index,
      transformMonsterId: entityId,
      monsterId: selfId,
      name: self.name + suffix,
      hp,
      maxHp: def.maxHp,
      mp,
      attack: def.attack,
      defense: def.defense,
      agility: def.agility,
      active: true,
      dead: false,
      sleepCounter: 0,
      paralyzed: false,
      confused: false,
      silenced: false,
      manusa: false,
      poisoned: false,
      defending: false,
      resting: false,
      mpShortage: false,
      defenseModifier: 0,
      agilityModifier: 0,
      turnAgility: 0,
      groupId: group,
      originalGroupId: group,
      isBetTarget: false,
      rotationCounter: 0,
      duplicateIndex: dup,
      highDefense: false,
      spellFailed: false,
    }
    this.fighters[index] = {
      s,
      def,
      baseDefense: def.defense,
      baseAgility: def.agility,
      maxMp: mp,
      actions: [emptyAction(), emptyAction(), emptyAction()],
      pendingActionCount: 0,
    }
  }

  // ─────────────────────────────── ターン開始 §3.1 ───────────────────────────────

  private turnStart(): void {
    this.push({ turn: this.turn, kind: 'turn-start', simple: `― ターン ${this.turn} ―` })
    for (let x = MAX_COMBATANTS - 1; x >= 0; x--) {
      const f = this.fighters[x]
      if (!f || !f.s.active) continue
      f.actions = [emptyAction(), emptyAction(), emptyAction()] // $02B52D
      f.pendingActionCount = 0
      f.s.defending = false // $2050.bit7 防御状態をクリア
    }
    // 混乱は戦闘終了まで自然回復しない（RGH 小ネタ集・gcgx・大辞典、docs/research/fidelity-review.md #7）。
    // 味方からの攻撃で解ける経路（覚醒考慮）は格闘場で成立するか公開資料では決まらず、実装しない（Approximation）
    // $23B0..$23B7 = 0
    this.usedConstrained.fill(0)
  }

  // ─────────────────────────────── 素早さ §3.2 ───────────────────────────────

  private decideTurnAgility(): number[] {
    const keys: number[] = new Array(MAX_COMBATANTS).fill(0)
    const rolls: Record<string, string> = {}
    // 23→0 の順に、アクティブ・生存者ごとに rand00FF_b を 1 回（§9 消費順 1）
    for (let x = MAX_COMBATANTS - 1; x >= 0; x--) {
      const f = this.fighters[x]
      if (!f) continue
      if (!this.isAlive(f)) {
        f.s.turnAgility = 0
        continue
      }
      const r = this.rng.rand00FF_b()
      f.s.turnAgility = turnAgilityFromRoll(f.s.agility, r)
      keys[x] = f.s.turnAgility
      rolls[`idx${x}`] = `(${f.s.agility}+20)*${r}/256+1=${f.s.turnAgility}`
    }
    // ここで並べた順が行動決定を呼ぶ順になる（§3.2, Confirmed）
    this.order = sortActionOrder(keys)
    this.push({
      turn: this.turn,
      kind: 'note',
      simple: '',
      detail: rolls,
      internal: { phase: 'turn-agility', decisionOrder: this.order.join(',') },
    })
    return this.order
  }

  // ─────────────────────────────── 行動決定 §4 ───────────────────────────────

  private decideMonsterActions(): void {
    for (const x of this.order) {
      const f = this.fighters[x]
      if (!f || !f.s.active) continue
      // 先制/強襲による抑止 $0264FA は格闘場では起きない（§1.2 補足, Likely）
      if (f.s.dead) continue
      if (f.s.paralyzed || f.s.sleepCounter !== 0 || f.s.resting) {
        // $02B4F1 行動なし（§4.1, Confirmed）
        f.actions = [emptyAction(), emptyAction(), emptyAction()]
        continue
      }
      const count = actionCountFromAttr(f.def.multiAction, this.rng)
      if (f.def.selectionJudgment === 2) {
        // 神はここでは行動を決めない（§4.1 $0264E4, Confirmed）。
        // U-05 暫定: 行動回数だけはターン開始時に決めておき、各行動枠の直前に 1 つずつ決める
        this.hit('U-05')
        f.pendingActionCount = count
        this.push({
          turn: this.turn,
          kind: 'note',
          simple: '',
          internal: { phase: 'decide', actorIndex: x, judgment: 2, actionCount: count, deferred: true },
        })
        continue
      }
      for (let k = 0; k < count; k++) f.actions[k] = this.decideOneAction(f)
      this.push({
        turn: this.turn,
        kind: 'note',
        simple: '',
        internal: {
          phase: 'decide',
          actorIndex: x,
          group: f.s.groupId,
          actionCount: count,
          actions: f.actions
            .slice(0, count)
            .map((a) => `${hex2(a.cmd)}@${hex2(a.target)}#${a.index}`)
            .join(' '),
          // $2462-$2466 集中攻撃記憶（Group 4 は末尾 = $2466）
          concentration: this.concentration.map(hex2).join(','),
        },
      })
    }
  }

  /** $0265DA 1 行動の決定 */
  private decideOneAction(f: Fighter): PlannedAction {
    const a = this.chooseCommandAndTarget(f)
    // $0265F7 並び順補正: 候補 = Group 5（PC）。格闘場には存在しないので常に無効（§5.3, Confirmed）
    this.concentrationTargetFix(f, a)
    return a
  }

  /** $02672D コマンドと対象の決定 */
  private chooseCommandAndTarget(f: Fighter): PlannedAction {
    const g = f.s.groupId
    const blocked = this.usedConstrained[g]
    const strategy = f.def.strategy
    const res = strategy === 3 ? this.strategyRotation(f, blocked) : this.strategyRoulette(f, strategy, blocked)
    if (!res) {
      // $02679D 行動が決められない場合は通常攻撃 #$01（§4.3, Confirmed）。対象は $026A07（j=1）
      const cmd = this.data.command(NORMAL_ATTACK_COMMAND_ID)
      const j = this.judge(f, cmd, 0x01)
      return { cmd: NORMAL_ATTACK_COMMAND_ID, target: j.ok ? j.target : TARGET_EMPTY, index: 8 }
    }
    if (f.def.commandConstraints[res.index]) this.usedConstrained[g] |= 1 << res.index
    return res
  }

  /** $0267B5 戦略 0..2 共通（§4.3, Confirmed） */
  private strategyRoulette(f: Fighter, strategy: number, blocked0: number): PlannedAction | null {
    let blocked = blocked0
    for (;;) {
      const index = rouletteIndex(strategy, blocked, this.rng)
      if (index === null) return null
      const cmdId = f.def.commands[index]
      const j = this.commandSelectable(f, cmdId)
      if (j.ok) return { cmd: cmdId, target: j.target, index }
      // $246C に追加して再抽選（格闘場許可 0 もここで除外される: §4.3 Confirmed）
      blocked |= 1 << index
    }
  }

  /**
   * 戦略 3（ローテーション）。本体未公開（U-06）。
   * 暫定: 個体のカウンタ c から始めて、選択可能な番号が見つかるまで 1 ずつ進める（8 周で無ければ失敗 →
   * 通常攻撃）。見つかった番号 + 1 を次回の c とする（決定時に更新）。$0268CD 4 行目はマスクとして使う。
   */
  private strategyRotation(f: Fighter, blocked0: number): PlannedAction | null {
    this.hit('U-06')
    let blocked = blocked0
    const c = f.s.rotationCounter
    for (let t = 0; t < 8; t++) {
      const index = (c + t) % 8
      if (blocked & (1 << index)) continue
      const cmdId = f.def.commands[index]
      const j = this.commandSelectable(f, cmdId)
      if (j.ok) {
        f.s.rotationCounter = (index + 1) % 8
        return { cmd: cmdId, target: j.target, index }
      }
      blocked |= 1 << index
    }
    return null
  }

  /** $0268ED コマンド選択判断（§4.4, Confirmed） */
  private commandSelectable(f: Fighter, cmdId: number): Judgment {
    if (cmdId === EMPTY_COMMAND_ID) return { ok: false }
    const cmd = this.data.command(cmdId)
    // 格闘場では「格闘場使用許可」0 のコマンドを選択不可にする（§1.2 #5, Confirmed）。
    // gameData.toArenaCommandId の「通常攻撃へ置換」は使わない（置換ではなく除外して再抽選: §4.3）
    if (!cmd.flags.arenaAllowed) return { ok: false }
    const sj = f.def.selectionJudgment
    const cost = cmd.mp
    if (sj === 1) {
      // 人間: 一度 MP 不足で失敗した後だけ MP を見る
      if (f.s.mpShortage && f.s.mp < cost) return { ok: false }
    } else if (sj === 2) {
      // 神: 常に MP を見る（$02B466）
      if (f.s.mp < cost) return { ok: false }
    }
    const j = cmd.targetJudgment[sj]
    return this.judge(f, cmd, j)
  }

  /**
   * 対象決定判断ジャンプテーブル $026971 + j*2。
   * 公開されているのは $026B7A（j=#$10 メガンテ判定）の条件部のみ。他はすべて U-04 暫定:
   * - 攻撃系は「候補が 1 体以上いれば選ぶ」
   * - 状態付与系の j1/j2 は「候補の中にまだその状態でない者がいれば選ぶ」（対象もその中から）
   * - 回復系の j1/j2 は「自グループに HP が減っている者がいれば選ぶ」
   * - 知能 2（神）は加えて自身がマホトーンなら呪文を選ばない
   * 同じ j は同じルーチンなので、意味付けはコマンドではなく j の値で行う。
   */
  private judge(f: Fighter, cmd: CommandDef, j: number): Judgment {
    if (j !== 0x10) this.hit(`U-04:j${j.toString(16).toUpperCase().padStart(2, '0')}`)
    if (f.def.selectionJudgment === 2 && cmd.flags.considersSilence && f.s.silenced) return { ok: false }

    const opp = (filter?: (t: Fighter) => boolean): Fighter[] => {
      const c = this.opponents(f)
      return filter ? c.filter(filter) : c
    }
    const single = (cands: Fighter[]): Judgment => {
      const t = this.pickFrom(cands)
      return t ? { ok: true, target: t.s.combatantIndex } : { ok: false }
    }
    const group = (cands: Fighter[]): Judgment => {
      const t = this.pickFrom(cands)
      return t ? { ok: true, target: TARGET_GROUP_FLAG | t.s.groupId } : { ok: false }
    }
    const all = (cands: Fighter[]): Judgment => (cands.length > 0 ? { ok: true, target: TARGET_ALL_ENEMIES } : { ok: false })
    const notAsleep = (t: Fighter) => t.s.sleepCounter === 0
    const byScope = (cands: Fighter[]): Judgment =>
      cmd.targetScope === 3 ? all(cands) : cmd.targetScope === 2 ? group(cands) : single(cands)

    switch (j) {
      case 0x00: // 対象なし（様子を見る・仲間呼び）
        return { ok: true, target: TARGET_EMPTY }
      case 0x01: // 単体・反対陣営（通常攻撃ほか。$026A07）
      case 0x0d: // 単体呪文（神）
      case 0x12: // マホトラ（人間）
      case 0x13: // マホトラ（神）
      case 0x40: // ふしぎなおどり（人間/神）
        return single(opp())
      case 0x02: // グループ・反対陣営
      case 0x0e: // グループ呪文（神）
        return group(opp())
      case 0x03: // 全体・反対陣営（息・メガンテ（バカ））
      case 0x11: // メガンテ（神）
        return all(opp())
      case 0x10: {
        // $026B7A メガンテ判定（人間）: HP >= maxHP/4 なら選ばない（Confirmed）。対象は $026A4B（未公開）
        if (f.s.hp >= f.s.maxHp >> 2) return { ok: false }
        this.hit('U-04:j10-target')
        return all(opp())
      }
      case 0x04: // 回復・自グループ単体（バカ）
        return single(this.ownGroup(f))
      case 0x16: // 回復・自グループ単体（人間）
      case 0x17: // 回復・自グループ単体（神）
        return single(this.ownGroup(f).filter((t) => t.s.hp < t.s.maxHp))
      case 0x18: // 回復・自身（人間）
      case 0x19: // 回復・自身（神）
        // j16/17 と同じ「HP が減っていれば選ぶ」とみなす。格闘場は 1 グループ 1 体なので自グループ = 自身になり、
        // #11 で自身版の ID に替えても勝率が変わらないことを実測で確かめた（fidelity-review.md #11）
        return f.s.hp < f.s.maxHp ? { ok: true, target: f.s.combatantIndex } : { ok: false }
      case 0x05: // 自身（ぼうぎょ・回復（バカ））
        return { ok: true, target: f.s.combatantIndex }
      case 0x07: // 自グループ（スクルト: バカ/人間）
      case 0x31: // スクルト（神）
        return group(this.ownGroup(f))
      case 0x14: // ボミオス（人間）
      case 0x15: // ボミオス（神）
        return group(opp((t) => t.s.agility >= t.def.agility))
      case 0x24: // ラリホー（人間）
      case 0x25: // ラリホー（神）
        return group(opp(notAsleep))
      case 0x26: // マホトーン
      case 0x27:
        return group(opp((t) => !t.s.silenced))
      case 0x28: // マヌーサ
      case 0x29:
        return group(opp((t) => !t.s.manusa))
      case 0x2c: // ルカナン
      case 0x2d:
        return group(opp((t) => t.s.defense >= t.def.defense))
      case 0x35: // メダパニ（神）
        return single(opp((t) => !t.s.confused))
      case 0x38: // どくのいき（人間/神）
        return all(opp((t) => !t.s.poisoned))
      case 0x39: // あまいいき（人間/神）
        return all(opp(notAsleep))
      default: {
        // 格闘場の実効コマンドでは現れない j。例外にはせず、コマンドの対象範囲・陣営から素朴に決める
        this.hit('unimplemented-judgment')
        this.push({
          turn: this.turn,
          kind: 'note',
          simple: '',
          internal: { unimplementedJudgment: hex2(j), commandId: hex2(cmd.id) },
        })
        if (cmd.targetSide === 1) return { ok: true, target: f.s.combatantIndex }
        if (cmd.targetSide === 2) return byScope(this.ownGroup(f))
        if (cmd.targetSide === 0) return { ok: true, target: TARGET_EMPTY }
        return byScope(opp())
      }
    }
  }

  /** $0266AB/$0266CA 集中攻撃補正（§5.4, Confirmed） */
  private concentrationTargetFix(f: Fighter, a: PlannedAction): void {
    if (a.cmd === EMPTY_COMMAND_ID) return
    const cmd = this.data.command(a.cmd)
    if (!cmd.flags.considersConcentration) return
    if (!f.def.concentrate) return
    if (f.def.selectionJudgment === 0) return // バカは集中しない
    const g = f.s.groupId
    if (g >= 5) return
    // Group 4（賭けた選手）は専用の記憶 $2466 を使う（Confirmed）
    const mem = this.concentration[g]
    // U-03 暫定: 記憶が「アクティブ かつ 死亡でない」なら有効
    this.hit('U-03')
    const memF = mem !== 0xff ? this.fighters[mem] : undefined
    if (memF && this.isAlive(memF)) {
      a.target = mem
      return
    }
    const t = this.pickFrom(this.opponents(f))
    if (t) {
      a.target = t.s.combatantIndex
      this.concentration[g] = t.s.combatantIndex
    }
  }

  // ─────────────────────────────── 行動順 §3.3 ───────────────────────────────

  private fixActionOrder(): void {
    const keys: number[] = new Array(MAX_COMBATANTS).fill(0)
    for (let x = 0; x < MAX_COMBATANTS; x++) {
      const f = this.fighters[x]
      if (!f || !this.isAlive(f)) continue
      // アストロン優先ボーナスは格闘場の出場者に無関係なので 0（§3.3, Likely）
      keys[x] = f.s.turnAgility + 0 + 1
      // $026446: 防御系コマンドを選んでいれば実行前のこの段階で防御状態を立てる（Likely）
      for (const a of f.actions) if (a.cmd === CMD.defend) f.s.defending = true
    }
    this.order = sortActionOrder(keys)
    this.push({
      turn: this.turn,
      kind: 'turn-order',
      simple: `行動順: ${this.order.map((x) => this.nm(this.fighters[x]!)).join(' → ')}`,
      detail: Object.fromEntries(this.order.map((x) => [this.nm(this.fighters[x]!), keys[x]])),
      internal: { order: this.order.join(',') },
    })
  }

  // ─────────────────────────────── 1 ターンの実行 §6.1 ───────────────────────────────

  /** $027275。決着したら true（c=on） */
  private executeOneTurn(): boolean {
    for (const x of this.order) {
      const f = this.fighters[x]
      // $0273A1 / $02B0D0: 途中で死亡・離脱した戦闘員は行動順から外れる（Confirmed）
      if (!f || !this.isAlive(f)) continue
      // $027329「格闘場中断処理?」: U-21 暫定で常に c=off
      this.hit('U-21')
      for (let k = 0; k < 3; k++) {
        if (k === 0 && f.s.sleepCounter > 0) this.tickSleep(f)
        // $0273B3 行動可能チェック: U-21 暫定で「非アクティブ・死亡・マヒ・眠り・休み」ならスキップ
        this.hit('U-21')
        if (!this.isAlive(f) || f.s.paralyzed || f.s.sleepCounter !== 0 || f.s.resting) continue
        // 神は手番直前に決める（U-05 暫定。$027563/$02758C のどこかと推定）
        if (f.def.selectionJudgment === 2 && k < f.pendingActionCount && f.actions[k].cmd === EMPTY_COMMAND_ID) {
          this.hit('U-05')
          f.actions[k] = this.decideOneAction(f)
          // U-05 暫定: 防御を直前に選んだ場合は選んだ時点で防御状態を立てる
          if (f.actions[k].cmd === CMD.defend) f.s.defending = true
          const a = f.actions[k]
          this.push({
            turn: this.turn,
            kind: 'note',
            simple: '',
            internal: {
              phase: 'decide-just-before',
              actorIndex: x,
              group: f.s.groupId,
              slotK: k,
              action: `${hex2(a.cmd)}@${hex2(a.target)}#${a.index}`,
              concentration: this.concentration.map(hex2).join(','),
            },
          })
        }
        const a = f.actions[k]
        if (a.cmd === EMPTY_COMMAND_ID) continue
        this.executeAction(f, a)
        // 決着判定は 1 行動ごと（§6.1, Confirmed）
        if (this.checkBattleEnd()) return true
      }
    }
    this.turnEnd()
    return this.checkBattleEnd()
  }

  /**
   * 自分の手番（行動枠 0）ごとの覚醒判定。n 回目の成功率は 1/8, 1/3, 1/2, 1（RGH 小ネタ集・gcgx）。
   * sleepCounter は「次が何回目の判定か」を持つ。行動はターン開始時に決めるので、起きたターンは動けず次のターンから動く。
   * 乱数の引き方（1/8 = rand0toA(7) === 0 など）は推測（Approximation）
   */
  private tickSleep(f: Fighter): void {
    this.hit('U-08')
    const n = f.s.sleepCounter
    const d = SLEEP_WAKE_DENOMS[Math.min(n, SLEEP_WAKE_DENOMS.length) - 1]
    // 4 回目は必ず覚醒するので乱数を引かない
    const woke = d === 1 || this.rng.rand0toA(d - 1) === 0
    f.s.sleepCounter = woke ? 0 : n + 1
    if (woke) {
      this.push({
        turn: this.turn,
        kind: 'status',
        actorSlot: f.s.slot,
        simple: `${this.nm(f)}は めをさました！`,
        internal: { actorIndex: f.s.combatantIndex, fidelity: 'U-08' },
      })
    }
  }

  /** $02A41F ターン終了処理（§7.9）。格闘場の出場者は全員自動回復 0 */
  private turnEnd(): void {
    const table: readonly (readonly [number, number])[] = [
      [0, 0],
      [16, 24],
      [44, 56],
      [90, 110],
    ]
    for (const x of this.order) {
      const f = this.fighters[x]
      if (!f || !this.isAlive(f) || f.def.autoHeal === 0) continue
      // 値は dqbook 自身が前作のコピーと注記しており未検証（§7.9 Unknown）
      this.hit('auto-heal-values')
      const [lo, hi] = table[f.def.autoHeal]
      const v = this.rng.randRangeXA(lo, hi)
      f.s.hp = Math.min(f.s.maxHp, f.s.hp + v)
      this.push({
        turn: this.turn,
        kind: 'heal',
        actorSlot: f.s.slot,
        simple: `${this.nm(f)}の キズが かいふくした！`,
        detail: { amount: v, hp: f.s.hp },
      })
    }
    this.push({
      turn: this.turn,
      kind: 'turn-end',
      simple: '',
      internal: { alive: this.all.filter((f) => this.isAlive(f)).length, endType: this.endType },
    })
  }

  // ─────────────────────────────── 1 行動の実行 §6.2 ───────────────────────────────

  private executeAction(f: Fighter, planned: PlannedAction): void {
    let cmdId = planned.cmd
    let target = planned.target
    let cmd = this.data.command(cmdId)

    // U-07 暫定: 混乱中は「混乱時通常攻撃化」=1 のコマンドを通常攻撃に置換し、
    // 反対陣営の単体/グループ対象は自分以外の全選手から一様に選び直す
    if (f.s.confused) {
      this.hit('U-07')
      if (cmd.flags.confusedToAttack) {
        cmdId = NORMAL_ATTACK_COMMAND_ID
        cmd = this.data.command(cmdId)
      }
      if (cmd.targetSide === 3 && (cmd.targetScope === 1 || cmd.targetScope === 2)) {
        const t = this.pickFrom(this.all.filter((o) => o !== f && this.isAlive(o)))
        if (t) target = cmd.targetScope === 2 ? TARGET_GROUP_FLAG | t.s.groupId : t.s.combatantIndex
      }
    }

    const kind = HANDLERS[cmd.battleHandler]
    const baseInternal = {
      actorIndex: f.s.combatantIndex,
      group: f.s.groupId,
      commandId: hex2(cmdId),
      commandIndex: planned.index,
      target: hex2(target),
    }
    if (!kind) {
      // 未実装コマンド: 例外にせず記録してスキップ（タスク指示）
      this.hit(`unimplemented-command:${hex2(cmdId)}`)
      this.push({
        turn: this.turn,
        kind: 'note',
        actorSlot: f.s.slot,
        simple: `${this.nm(f)}は ${displayCommandName(cmd)}を つかおうとした。（未実装）`,
        internal: { ...baseInternal, handler: cmd.battleHandler },
      })
      return
    }

    // $0279D5 攻撃ターゲット決定（U-02 暫定の空振り時再抽選を含む）
    const targets = this.resolveTargets(f, cmd, target)
    const msg = this.actionMessage(f, cmd, kind)
    if (targets === null) {
      // U-02 暫定: 再抽選考慮 0 のコマンドは空振り（何もしない）。MP 消費の有無は不明なので消費しない側
      this.push({
        turn: this.turn,
        kind: 'action',
        actorSlot: f.s.slot,
        simple: msg,
        internal: { ...baseInternal, handler: kind },
      })
      this.push({
        turn: this.turn,
        kind: 'miss',
        actorSlot: f.s.slot,
        simple: 'しかし あいては もう いなかった。',
        internal: { whiff: true, fidelity: 'U-02' },
      })
      return
    }

    this.push({
      turn: this.turn,
      kind: 'action',
      actorSlot: f.s.slot,
      targetSlots: targets.map((t) => t.s.slot),
      simple: msg,
      detail: { mp: f.s.mp === INFINITE_MP ? '∞' : f.s.mp, cost: cmd.mp },
      internal: { ...baseInternal, handler: kind, targets: targets.map((t) => t.s.combatantIndex).join(',') },
    })

    // $027C41 → $027C68 実行可否（§4.5, Confirmed）
    if (!this.canExecute(f, cmd)) return

    this.executeMain(f, cmdId, cmd, kind, targets)
  }

  private actionMessage(f: Fighter, cmd: CommandDef, kind: HandlerKind): string {
    const n = this.nm(f)
    const c = displayCommandName(cmd)
    switch (kind) {
      case 'attack':
        return `${n}の こうげき！`
      case 'defend':
        return `${n}は みを まもっている。`
      case 'nothing':
        return `${n}は ようすを みている。`
      case 'odori':
        return `${n}は ふしぎなおどりを おどった！`
      default:
        if (cmd.flags.considersSilence) return `${n}は ${c}を となえた！`
        return `${n}は ${c}を はいた！`
    }
  }

  /**
   * 行動対象の決定（$0279D5/$02758C/$027B52 は未公開）。
   * null = 空振り（対象無し）。空配列は「対象なし」コマンド（様子を見る等）。
   */
  private resolveTargets(f: Fighter, cmd: CommandDef, enc: number): Fighter[] | null {
    if (cmd.targetScope === 0 || enc === TARGET_EMPTY) {
      if (cmd.targetScope === 0) return []
      // 判断ルーチンが空を返したまま実行に来た（フォールバック通常攻撃で候補 0 など）
      return this.retargetOrWhiff(f, cmd)
    }
    if (enc === TARGET_ALL_ENEMIES) {
      // 全体: 実行時点の候補全員（U-01）。処理順は戦闘員インデックス昇順（§6.3）
      const c = this.opponents(f)
      return c.length > 0 ? c : null
    }
    if (enc & TARGET_GROUP_FLAG) {
      const g = enc & 0x1f
      const members = this.groupMembers(g)
      if (members.length > 0) return members
      return this.retargetOrWhiff(f, cmd)
    }
    const t = this.fighters[enc]
    if (t && this.isAlive(t)) return [t]
    return this.retargetOrWhiff(f, cmd)
  }

  /** U-02 暫定: 再抽選考慮=1 のコマンドだけ U-01 の候補から一様に選び直す */
  private retargetOrWhiff(f: Fighter, cmd: CommandDef): Fighter[] | null {
    this.hit('U-02')
    if (!cmd.flags.retargetOnWhiff) return null
    const cands = cmd.targetSide === 2 || cmd.targetSide === 1 ? this.ownGroup(f) : this.opponents(f)
    const t = this.pickFrom(cands)
    if (!t) return null
    return cmd.targetScope === 2 ? this.groupMembers(t.s.groupId) : [t]
  }

  /** $027C68（§4.5, Confirmed）: MP 不足なら失敗しフラグ。足りれば先に MP を引き、その後マホトーン判定 */
  private canExecute(f: Fighter, cmd: CommandDef): boolean {
    const cost = cmd.mp
    if (f.s.mp !== INFINITE_MP && f.s.mp < cost) {
      f.s.mpShortage = true
      f.s.spellFailed = true
      this.push({
        turn: this.turn,
        kind: 'miss',
        actorSlot: f.s.slot,
        simple: 'しかし MPが たりない！',
        detail: { mp: f.s.mp, cost },
        internal: { mpShortageFlag: true },
      })
      return false
    }
    // MP=65535 は減らない（Likely: dqbook）
    if (f.s.mp !== INFINITE_MP) f.s.mp -= cost
    if (cmd.flags.considersSilence && f.s.silenced) {
      f.s.spellFailed = true
      this.push({
        turn: this.turn,
        kind: 'miss',
        actorSlot: f.s.slot,
        simple: 'しかし じゅもんは ふうじこめられている！',
        detail: { mpAfter: f.s.mp === INFINITE_MP ? '∞' : f.s.mp, cost },
      })
      return false
    }
    return true
  }

  // ─────────────────────────────── 対象ごとのパイプライン §6.3 ───────────────────────────────

  private executeMain(f: Fighter, cmdId: number, cmd: CommandDef, kind: HandlerKind, targets: Fighter[]): void {
    if (kind === 'nothing' || kind === 'defend') return
    const targetSet = new Set(targets.map((t) => t.s.combatantIndex))
    let meganteExecuted = false
    for (let y = 0; y < MAX_COMBATANTS; y++) {
      // $027DD1 メガンテ実行時の効果決定: 対象か否かに関わらず y ごとに引く（RGH-017/018, Confirmed）
      let megaMode = 0
      if (cmdId === CMD.megante && f.s.groupId < 5) {
        if ((this.rng.rand00FF() & 1) === 0) megaMode = 1
      }
      if (!targetSet.has(y)) continue
      const t = this.fighters[y]
      if (!t) continue
      // $028426 有効判定: 1. アクティブでない 2. 対象生存条件（0: 生存）
      if (!t.s.active) continue
      if (cmd.targetAliveCondition === 0 && t.s.dead) continue
      if (cmd.targetAliveCondition === 1 && !t.s.dead) continue
      // 6. みかわし（§6.4）
      if (this.evades(f, cmd, t)) continue
      // 7. 攻撃側のミス: マヌーサ（§6.5, Confirmed）
      if (cmd.flags.considersManusa && f.s.manusa) {
        const r = this.rng.rand00FF()
        if ((r & 1) === 0) {
          this.push({
            turn: this.turn,
            kind: 'miss',
            actorSlot: f.s.slot,
            targetSlots: [t.s.slot],
            simple: `ミス！ ${this.nm(t)}は ダメージを うけない！`,
            detail: { manusa: true, roll: r },
          })
          continue
        }
      }
      if (kind === 'megante') meganteExecuted = true
      this.runHandler(f, cmdId, cmd, kind, t, megaMode)
    }
    // $028A96 → $028B71: メガンテが一度でも実行されたら術者が死ぬ（§6.9, Confirmed）
    if (meganteExecuted && this.isAlive(f)) {
      f.s.hp = 0
      f.s.dead = true
      this.push({
        turn: this.turn,
        kind: 'defeat',
        actorSlot: f.s.slot,
        targetSlots: [f.s.slot],
        simple: `${this.nm(f)}は ちからつき いきたえた。`,
        internal: { meganteCaster: true },
      })
    }
  }

  /** $028690 → $02873E みかわし（§6.4）。回避したら true */
  private evades(f: Fighter, cmd: CommandDef, t: Fighter): boolean {
    if (!cmd.flags.considersEvasion) return false
    // 対象がマヒ中・眠り中なら回避判定しない（Confirmed）
    if (t.s.paralyzed || t.s.sleepCounter !== 0) return false
    // U-12 暫定: 分子 = みかわし + 1。分母は対象グループ ≥ 4 で 63（Confirmed）
    this.hit('U-12')
    const { num, denom } = evasionParams(t.def.evasion, t.s.groupId)
    const r = this.rng.rand0toA(denom)
    if (r < num) {
      this.push({
        turn: this.turn,
        kind: 'miss',
        actorSlot: f.s.slot,
        targetSlots: [t.s.slot],
        simple: `${this.nm(t)}は すばやく みをかわした！`,
        detail: { evasionNum: num, evasionDenom: denom + 1, roll: r },
        internal: { targetIndex: t.s.combatantIndex, targetGroup: t.s.groupId },
      })
      return true
    }
    return false
  }

  /** U-13 暫定の耐性ロール: 成功 ⇔ rand00FF() < p256[耐性] */
  private resistanceRoll(t: Fighter, resIdx: number): { ok: boolean; detail: Record<string, number> } {
    this.hit('U-13')
    const res = t.def.resistances[resIdx] ?? 0
    const p = RESISTANCE_P256[res]
    const r = this.rng.rand00FF()
    return { ok: r < p, detail: { resistanceNo: resIdx, resistance: res, p256: p, roll: r } }
  }

  /** U-13 暫定: 系統 0 の状態系・眠り/毒/マヒ攻撃は rand00FF() < 成功率係数0 × 32 */
  private fixedRateRoll(cmd: CommandDef): { ok: boolean; detail: Record<string, number> } {
    this.hit('U-13')
    const p = cmd.successRate[0] * 32
    const r = this.rng.rand00FF()
    return { ok: r < p, detail: { p256: p, roll: r } }
  }

  /** コマンド系統に応じた成否（耐性番号があれば耐性ロール、無ければ固定成功率） */
  private statusRoll(cmd: CommandDef, t: Fighter): { ok: boolean; detail: Record<string, number> } {
    const resIdx = resistanceIndexForCategory(cmd.category)
    return resIdx === null ? this.fixedRateRoll(cmd) : this.resistanceRoll(t, resIdx)
  }

  private runHandler(f: Fighter, cmdId: number, cmd: CommandDef, kind: HandlerKind, t: Fighter, megaMode: number): void {
    switch (kind) {
      case 'attack':
        return this.handleAttack(f, cmdId, cmd, t)
      case 'spell-damage':
        return this.handleSpellDamage(f, cmd, t)
      case 'megante':
        return this.handleMegante(f, cmd, t, megaMode)
      case 'zaki': {
        const roll = this.statusRoll(cmd, t)
        if (!roll.ok) return this.noEffect(f, t, roll.detail)
        t.s.hp = 0
        t.s.dead = true
        this.push({
          turn: this.turn,
          kind: 'defeat',
          actorSlot: f.s.slot,
          targetSlots: [t.s.slot],
          simple: `${this.nm(t)}は いきたえた！`,
          detail: roll.detail,
        })
        return
      }
      case 'basiruura': {
        const roll = this.statusRoll(cmd, t)
        if (!roll.ok) return this.noEffect(f, t, roll.detail)
        // 成功すると対象のアクティブフラグが 0 になり、以後一切の対象にならない（§6.10, Likely）
        t.s.active = false
        this.push({
          turn: this.turn,
          kind: 'leave',
          actorSlot: f.s.slot,
          targetSlots: [t.s.slot],
          simple: `${this.nm(t)}は どこかへ ふきとばされた！`,
          detail: roll.detail,
        })
        return
      }
      case 'mahotora':
        return this.handleMahotora(f, cmd, t)
      case 'odori':
        return this.handleOdori(f, cmd, t)
      case 'heal':
        return this.handleHeal(f, cmd, t)
      case 'sleep': {
        const roll = this.statusRoll(cmd, t)
        if (!roll.ok) return this.noEffect(f, t, roll.detail)
        this.applySleep(f, t, roll.detail)
        return
      }
      case 'mahoton':
        return this.simpleStatus(f, cmd, t, 'silenced', `${this.nm(t)}の じゅもんを ふうじこめた！`)
      case 'manusa':
        return this.simpleStatus(f, cmd, t, 'manusa', `${this.nm(t)}は まぼろしに つつまれた！`)
      case 'medapani':
        return this.simpleStatus(f, cmd, t, 'confused', `${this.nm(t)}は こんらんした！`)
      case 'poison-breath':
        return this.simpleStatus(f, cmd, t, 'poisoned', `${this.nm(t)}は どくに おかされた！`)
      case 'paralyze-breath': {
        const before = t.s.paralyzed
        this.simpleStatus(f, cmd, t, 'paralyzed', `${this.nm(t)}は からだが しびれて うごけなくなった！`)
        // U-08 暫定: マヒは戦闘中に回復しない
        if (!before && t.s.paralyzed) this.hit('U-08')
        return
      }
      case 'rukanan':
      case 'bomios':
      case 'sukuruto':
        return this.handleStatModifier(f, cmd, kind, t)
      case 'defend':
      case 'nothing':
        return
    }
  }

  private noEffect(f: Fighter, t: Fighter, detail: Record<string, number | string | boolean>): void {
    this.push({
      turn: this.turn,
      kind: 'miss',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: `${this.nm(t)}には きかなかった！`,
      detail,
    })
  }

  /** 真偽フラグの状態付与（U-13 成否 / U-14 既にその状態なら変化なし） */
  private simpleStatus(
    f: Fighter,
    cmd: CommandDef,
    t: Fighter,
    key: 'silenced' | 'manusa' | 'confused' | 'poisoned' | 'paralyzed',
    text: string,
  ): void {
    const roll = this.statusRoll(cmd, t)
    if (!roll.ok) return this.noEffect(f, t, roll.detail)
    if (t.s[key]) {
      // 既にその状態の場合の扱いは未公開（U-14）。暫定: 変化もメッセージも無し
      this.hit('U-14')
      this.push({ turn: this.turn, kind: 'note', simple: '', internal: { alreadyInState: key, targetIndex: t.s.combatantIndex } })
      return
    }
    t.s[key] = true
    this.push({
      turn: this.turn,
      kind: 'status',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: text,
      detail: roll.detail,
    })
  }

  /** 眠り付与（$02B5D8）。覚醒判定を 1 回目から始める。既に眠っていれば c=on で抜ける（メッセージなし） */
  private applySleep(f: Fighter, t: Fighter, detail: Record<string, number>): void {
    if (t.s.sleepCounter !== 0) {
      this.push({ turn: this.turn, kind: 'note', simple: '', internal: { alreadyAsleep: true, targetIndex: t.s.combatantIndex } })
      return
    }
    this.hit('U-08')
    t.s.sleepCounter = 1
    this.push({
      turn: this.turn,
      kind: 'status',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: `${this.nm(t)}を ねむらせた！`,
      detail: { ...detail, sleepCounter: t.s.sleepCounter },
    })
  }

  /** 通常攻撃・痛恨・眠り/毒/マヒ攻撃（$028DA9 → §7.1, §7.2, §6.6, §7.6） */
  private handleAttack(f: Fighter, cmdId: number, cmd: CommandDef, t: Fighter): void {
    // §7.1: 行動主体グループ < 5（Group 4 含む）はモンスター式
    const calc = normalAttackDamage(f.s.attack, t.s.defense, this.rng)
    let dmg = calc.damage
    const detail: Record<string, number | string | boolean> = {
      attack: calc.attack,
      defense: calc.defense,
      d: calc.d,
      a8: calc.a8,
      branch: calc.branch,
      roll: calc.roll,
      base: calc.damage,
    }
    // d. 会心・痛恨 $02903E（§6.6）: 会心考慮=0 なら判定しない。モンスターは #$02 のみ 1/8
    let critical = false
    if (cmd.flags.considersCritical && cmdId === CMD.critical) {
      const r = this.rng.rand0toA(7)
      detail.criticalRoll = r
      if (r === 0) {
        const c = criticalDamage(f.s.attack, this.rng)
        critical = true
        dmg = c.damage
        detail.criticalMul = c.roll
        detail.criticalDamage = c.damage
      }
    }
    // h. 防御中なら半減（§7.2 h, Confirmed）
    if (t.s.defending) {
      dmg = Math.floor(dmg / 2)
      detail.defending = true
    }
    // i. 耐性ロール: 系統 0 は常に成功（Likely）、眠り/毒/マヒ攻撃は除外（Confirmed）→ 乱数を引かない
    if (critical) {
      this.push({ turn: this.turn, kind: 'note', actorSlot: f.s.slot, simple: 'つうこんの いちげき！' })
    }
    const finalDamage = this.applyDamage(f, t, dmg, detail)
    // §7.6 追加効果 $0288CF
    if (cmdId === CMD.sleepAttack || cmdId === CMD.poisonAttack || cmdId === CMD.paralyzeAttack) {
      this.addedEffect(f, cmdId, cmd, t, finalDamage)
    }
  }

  /** $0288CF 眠り・毒・マヒ攻撃の追加効果（§7.6） */
  private addedEffect(f: Fighter, cmdId: number, cmd: CommandDef, t: Fighter, finalDamage: number): void {
    if (finalDamage === 0) return
    if (!this.isAlive(t)) return
    // U-13 暫定: rand00FF() < 成功率係数0 × 32（眠り 96 / 毒 64 / マヒ 32）
    const roll = this.fixedRateRoll(cmd)
    if (!roll.ok) return
    if (cmdId === CMD.sleepAttack) return this.applySleep(f, t, roll.detail)
    const key = cmdId === CMD.poisonAttack ? 'poisoned' : 'paralyzed'
    if (t.s[key]) return // 既に同じ状態ならメッセージなし（Confirmed）
    t.s[key] = true
    if (key === 'paralyzed') this.hit('U-08')
    this.push({
      turn: this.turn,
      kind: 'status',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: key === 'poisoned' ? `${this.nm(t)}は どくに おかされた！` : `${this.nm(t)}は からだが しびれて うごけなくなった！`,
      detail: roll.detail,
    })
  }

  /** 攻撃呪文・息（§7.3）。対象ごとに抽選（Likely） */
  private handleSpellDamage(f: Fighter, cmd: CommandDef, t: Fighter): void {
    const dmgDef = this.data.damage(cmd.damageId)
    // $C90AF7: 行動主体グループ ≥ 5 なら PC 値。Group 4 は敵陣側の値（Confirmed）
    const [lo, hi] = f.s.groupId >= 5 ? [dmgDef.pcMin, dmgDef.pcMax] : [dmgDef.enemyMin, dmgDef.enemyMax]
    let dmg = lo === DAMAGE_FULL ? 65535 : this.rng.randRangeXA(lo, hi)
    const detail: Record<string, number | string | boolean> = { damageId: cmd.damageId, lo, hi, base: dmg }
    if (t.s.defending) {
      dmg = Math.floor(dmg / 2)
      detail.defending = true
    }
    const resIdx = resistanceIndexForCategory(cmd.category)
    if (resIdx !== null) {
      const roll = this.resistanceRoll(t, resIdx)
      Object.assign(detail, roll.detail)
      if (!roll.ok) dmg = 0
    }
    this.applyDamage(f, t, dmg, detail)
  }

  /** メガンテ $0293E0（§6.9, Confirmed） */
  private handleMegante(f: Fighter, cmd: CommandDef, t: Fighter, megaMode: number): void {
    const resIdx = resistanceIndexForCategory(cmd.category) ?? 0x05
    const roll = this.resistanceRoll(t, resIdx)
    if (!roll.ok) return this.noEffect(f, t, roll.detail)
    if (megaMode === 0) {
      t.s.hp = 0
      t.s.dead = true
      this.push({
        turn: this.turn,
        kind: 'defeat',
        actorSlot: f.s.slot,
        targetSlots: [t.s.slot],
        simple: `${this.nm(t)}は くだけちった！`,
        detail: { ...roll.detail, megaMode },
      })
      return
    }
    let dmg = meganteDamage(t.s.hp)
    const detail: Record<string, number | string | boolean> = { ...roll.detail, megaMode, hpBefore: t.s.hp, base: dmg }
    // 通常のダメージ確定 $028E70（耐性ロール対象外、防御なら半減）
    if (t.s.defending) {
      dmg = Math.floor(dmg / 2)
      detail.defending = true
    }
    this.applyDamage(f, t, dmg, detail)
  }

  /** $029200 ダメージ適用。0 ならダメージなしメッセージ。戻り値は最終ダメージ（$23FA） */
  private applyDamage(f: Fighter, t: Fighter, dmg: number, detail: Record<string, number | string | boolean>): number {
    if (dmg === 0) {
      this.push({
        turn: this.turn,
        kind: 'miss',
        actorSlot: f.s.slot,
        targetSlots: [t.s.slot],
        simple: `ミス！ ${this.nm(t)}に ダメージを あたえられない！`,
        detail: { ...detail, damage: 0 },
        internal: { targetIndex: t.s.combatantIndex, targetGroup: t.s.groupId },
      })
      return 0
    }
    // HP は 0 未満にならない（$02BE8A 内部, Likely）
    t.s.hp = Math.max(0, t.s.hp - dmg)
    this.push({
      turn: this.turn,
      kind: 'damage',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: `${this.nm(t)}に ${dmg}の ダメージ！`,
      detail: { ...detail, damage: dmg, targetHp: t.s.hp },
      internal: { targetIndex: t.s.combatantIndex, targetGroup: t.s.groupId },
    })
    if (t.s.hp === 0) {
      t.s.dead = true
      this.push({
        turn: this.turn,
        kind: 'defeat',
        actorSlot: f.s.slot,
        targetSlots: [t.s.slot],
        simple: `${this.nm(t)}を たおした！`,
      })
    }
    return dmg
  }

  /** ホイミ系 $029610（§7.5, Likely）: 回復量 = 敵陣側の抽選値。べホマ（1023）は全快 */
  private handleHeal(f: Fighter, cmd: CommandDef, t: Fighter): void {
    const d = this.data.damage(cmd.damageId)
    const [lo, hi] = f.s.groupId >= 5 ? [d.pcMin, d.pcMax] : [d.enemyMin, d.enemyMax]
    const amount = lo === DAMAGE_FULL ? 65535 : this.rng.randRangeXA(lo, hi)
    const before = t.s.hp
    t.s.hp = Math.min(t.s.maxHp, t.s.hp + amount)
    this.push({
      turn: this.turn,
      kind: 'heal',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: `${this.nm(t)}の キズが かいふくした！`,
      detail: { damageId: cmd.damageId, lo, hi, amount, hpBefore: before, hp: t.s.hp },
    })
  }

  /** マホトラ（U-14 暫定）: 対象 MP から min(抽選値, 対象MP) を引いて術者に加算（最大 MP で頭打ち、65535 は変化なし） */
  private handleMahotora(f: Fighter, cmd: CommandDef, t: Fighter): void {
    const roll = this.statusRoll(cmd, t)
    if (!roll.ok) return this.noEffect(f, t, roll.detail)
    this.hit('U-14')
    const d = this.data.damage(cmd.damageId)
    const v = this.rng.randRangeXA(d.enemyMin, d.enemyMax)
    const taken = Math.min(v, t.s.mp)
    if (t.s.mp !== INFINITE_MP) t.s.mp -= taken
    if (f.s.mp !== INFINITE_MP) f.s.mp = Math.min(f.maxMp, f.s.mp + taken)
    this.push({
      turn: this.turn,
      kind: 'status',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: taken > 0 ? `${this.nm(t)}の MPを ${taken} すいとった！` : `${this.nm(t)}は MPを もっていない！`,
      detail: { ...roll.detail, roll5to10: v, taken },
    })
  }

  /** ふしぎなおどり（§6.10, Likely: 5..10）。系統 0 なので耐性ロールなし。量の扱いは U-14 暫定 */
  private handleOdori(f: Fighter, cmd: CommandDef, t: Fighter): void {
    this.hit('U-14')
    const d = this.data.damage(cmd.damageId)
    const v = this.rng.randRangeXA(d.enemyMin, d.enemyMax)
    const taken = Math.min(v, t.s.mp)
    if (t.s.mp !== INFINITE_MP) t.s.mp -= taken
    this.push({
      turn: this.turn,
      kind: 'status',
      actorSlot: f.s.slot,
      targetSlots: [t.s.slot],
      simple: `${this.nm(t)}の MPが ${taken} へった！`,
      detail: { roll5to10: v, taken },
    })
  }

  /**
   * ルカナン・ボミオス・スクルト（U-14 暫定量）。
   * ROM は補正量ではなく現在値を書き換える（$0299F5）ので、現在値を直接更新し補正量は導出する。
   */
  private handleStatModifier(f: Fighter, cmd: CommandDef, kind: 'rukanan' | 'bomios' | 'sukuruto', t: Fighter): void {
    let detail: Record<string, number | string | boolean> = {}
    if (kind !== 'sukuruto') {
      const roll = this.statusRoll(cmd, t)
      if (!roll.ok) return this.noEffect(f, t, roll.detail)
      detail = roll.detail
    }
    this.hit('U-14')
    let text: string
    if (kind === 'sukuruto') {
      const before = t.s.defense
      let v = before + Math.floor(t.baseDefense / 2)
      if (v >= DEFENSE_CAP) {
        // 1023 でクリップし高守備力フラグ（Confirmed）
        v = DEFENSE_CAP
        t.s.highDefense = true
      }
      t.s.defense = v
      text = `${this.nm(t)}の しゅびりょくが ${v - before} あがった！`
      detail = { ...detail, before, after: v }
    } else if (kind === 'rukanan') {
      const before = t.s.defense
      // 現在の守備力の 1/2 を下げる（gcgx・dqwiz・d-navi が一致。fidelity-review.md #14）
      t.s.defense = before - Math.floor(before / 2)
      text = `${this.nm(t)}の しゅびりょくが ${before - t.s.defense} さがった！`
      detail = { ...detail, before, after: t.s.defense }
    } else {
      const before = t.s.agility
      // 素早さを 0 にする（gcgx・dqwiz・大辞典が一致。fidelity-review.md #14）
      t.s.agility = 0
      t.s.agilityModifier = t.s.agility - t.baseAgility
      text = `${this.nm(t)}の すばやさが ${before - t.s.agility} さがった！`
      detail = { ...detail, before, after: t.s.agility }
    }
    t.s.defenseModifier = t.s.defense - t.baseDefense
    this.push({ turn: this.turn, kind: 'status', actorSlot: f.s.slot, targetSlots: [t.s.slot], simple: text, detail })
  }

  // ─────────────────────────────── 終了判定 §8 ───────────────────────────────

  /** $02B32F（§8.1）。c=on（終了）で true */
  private checkBattleEnd(): boolean {
    // U-15 暫定: 残存 = アクティブ かつ 死亡でない。$02B3C1 = [1, 5, 2, 6]
    this.hit('U-15')
    const t = this.endType
    if (t !== 0 && t !== 6) return true
    const alive = this.all.filter((f) => this.isAlive(f))
    const sideA = alive.some((f) => f.s.groupId <= 3) // $02B3C5: Group 0-3（Likely）
    const sideB = alive.some((f) => f.s.groupId >= 4) // $02B3E8: Group ≥ 4（Likely）
    if (sideA && sideB) return false
    // 表 [1, 5, 2, 6] の格闘場側（通常戦は 1 / 2）: 陣営 A 全滅 → 5（当たり）、陣営 B 全滅 → 6（ハズレ）
    this.endType = sideA ? 6 : 5
    const n = alive.length
    if (n === 0) {
      this.endType = 7
      return true
    }
    if (n >= 2) return false // タイプ 6 は書いたまま続行
    return true
  }

  /** $02A48C（§8.3）。c=on（終了）で true */
  private checkTurnLimit(): boolean {
    this.elapsedTurns += 1
    if (this.elapsedTurns >= ARENA_TURN_LIMIT) {
      // 通常戦はここでタイプ 4 になるが、格闘場は未決着なら引き分け（7）
      if ((this.endType & 0x0f) === 0) this.endType = 7
      return true
    }
    return false
  }

  private buildOutcome(turnLimit: boolean): BattleOutcome {
    const turn = this.turn
    const survivors = this.all.filter((f) => this.isAlive(f)).map((f) => f.s.slot)
    const et = this.endType as ArenaEndType
    if (et === 7) return { kind: 'draw', reason: turnLimit ? 'turn-limit' : 'all-inactive', turn, endType: 7 }
    if (turnLimit) {
      // 10 ターン終了時にタイプ 6（賭けた選手は倒れ、他が 2 体以上）
      return { kind: 'no-winner', reason: 'turn-limit', turn, endType: 6, survivors }
    }
    if ((et === 5 || et === 6) && survivors.length === 1) {
      return { kind: 'winner', slot: survivors[0], turn, endType: et }
    }
    // $02B32F の分岐上ここには来ない（到達したら仕様の読み違い）
    throw new Error(`想定外の終了状態: endType=${this.endType} survivors=${survivors.join(',')}`)
  }

  private outcomeText(o: BattleOutcome): string {
    switch (o.kind) {
      case 'winner': {
        const f = this.all.find((x) => x.s.slot === o.slot)!
        return `${this.nm(f)}の かち！`
      }
      case 'draw':
        return o.reason === 'turn-limit' ? 'じかんぎれ！ ひきわけ！' : 'のこった モンスターが いない！ ひきわけ！'
      case 'no-winner':
        return 'じかんぎれ！ しょうしゃ なし（かけた モンスターは たおれた）'
    }
  }
}
