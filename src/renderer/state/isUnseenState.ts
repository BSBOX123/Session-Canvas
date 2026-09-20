import type { SessionState } from '@shared/types'

/** `waiting`과 `done`만 unseen 플래그를 갖는다 (SPEC 8.1). */
export function isUnseenState(state: SessionState): boolean {
  return state === 'waiting' || state === 'done'
}
