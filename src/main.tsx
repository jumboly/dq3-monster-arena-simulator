import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createDQ3ArenaGame } from './core/arena/DQ3ArenaGame'
import { DQ3BattleEngine } from './core/battle/DQ3BattleEngine'
import { createStores } from './storage/session'
import { ArenaContext, type ArenaDeps } from './ui/hooks/arenaContext'
import { ArenaStore } from './ui/logic/arenaStore'
import { AutoPlayController } from './ui/logic/autoPlayController'

// 依存の組み立てはここ 1 か所。StrictMode の二重描画でストアが作り直されないよう React の外で作る
const stores = createStores()
// 試合を解決するたびに現在の設定を読むので、引き分けの扱いの変更は次の試合から反映される
const game = createDQ3ArenaGame({ engine: new DQ3BattleEngine(), drawPolicy: () => store.getState().settings.drawPolicy })
const store = new ArenaStore(game, stores)
const deps: ArenaDeps = { game, store, autoPlay: new AutoPlayController(game, store) }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ArenaContext.Provider value={deps}>
      <App />
    </ArenaContext.Provider>
  </StrictMode>,
)
