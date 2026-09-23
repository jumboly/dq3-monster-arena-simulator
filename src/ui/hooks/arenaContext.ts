import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { ArenaState, ArenaStore } from '../logic/arenaStore'
import type { AutoPlayController, AutoPlayState } from '../logic/autoPlayController'

export interface ArenaDeps {
  game: ArenaGame
  store: ArenaStore
  autoPlay: AutoPlayController
}

export function useAutoPlayState(): AutoPlayState {
  const { autoPlay } = useArenaDeps()
  return useSyncExternalStore(autoPlay.subscribe, autoPlay.getState)
}

/** props のバケツリレーを避けつつ、テストや本実装差し替え時に依存を注入できるよう Context にする */
export const ArenaContext = createContext<ArenaDeps | null>(null)

export function useArenaDeps(): ArenaDeps {
  const deps = useContext(ArenaContext)
  if (!deps) throw new Error('ArenaContext が未設定です')
  return deps
}

export function useArenaState(): ArenaState {
  const { store } = useArenaDeps()
  return useSyncExternalStore(store.subscribe, store.getState)
}
