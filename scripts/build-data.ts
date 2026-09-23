/**
 * `npm run data`: vendor/dqbook の解析データから src/data/generated/game-data.json を生成する。
 *
 * 生成物を git 管理しないのは ROM 由来データを配布物に含めない方針のため（.gitignore 参照）。
 * 名前解決や書式検査に失敗した場合は例外で終了し、不完全な JSON を残さない。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGameData } from './lib/buildGameData'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'src/data/generated/game-data.json')

const { gameData } = buildGameData(join(root, 'vendor/dqbook'))

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(gameData, null, 2)}\n`)

console.log(
  `${relative(root, outFile)}: monsters=${gameData.monsters.length} commands=${gameData.commands.length} ` +
    `damages=${gameData.damages.length} matchCards=${gameData.matchCards.length} (dqbook ${gameData.sourceCommit.slice(0, 7)})`,
)
