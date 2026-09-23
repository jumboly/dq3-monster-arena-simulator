import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createStores } from './storage/session'
import { configureArenaGame, getArenaGame, readArenaGameConfig } from './ui/arenaGameProvider'
import { ArenaContext, type ArenaDeps } from './ui/hooks/arenaContext'
import { ArenaStore } from './ui/logic/arenaStore'
import { AutoPlayController } from './ui/logic/autoPlayController'

// 依存の組み立てはここ 1 か所。StrictMode の二重描画でストアが作り直されないよう React の外で作る
const stores = createStores()
configureArenaGame(readArenaGameConfig(stores))
const game = getArenaGame()
const store = new ArenaStore(game, stores)
// 引き分け払い戻しなど生成時オプションの設定変更を、次の試合から ArenaGame に反映する
store.subscribe(() => configureArenaGame({ drawPolicy: store.getState().settings.drawPolicy }))
const deps: ArenaDeps = { game, store, autoPlay: new AutoPlayController(game, store) }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ArenaContext.Provider value={deps}>
      <App />
    </ArenaContext.Provider>
  </StrictMode>,
)
