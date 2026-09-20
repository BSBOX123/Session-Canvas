import type { SessionState } from '@shared/types'

/**
 * SPEC 8.1 — **색만으로 전달하지 않는다.** 기호 + 문구 + 색을 함께 쓴다.
 */
export interface StatusPresentation {
  symbol: string
  label: string
  className: string
}

const TABLE: Record<SessionState, StatusPresentation> = {
  unknown: { symbol: '○', label: '대기', className: 'unknown' },
  working: { symbol: '◐', label: '작업 중', className: 'working' },
  waiting: { symbol: '●', label: '입력 대기', className: 'waiting' },
  done: { symbol: '✓', label: '완료', className: 'done' },
  detached: { symbol: '–', label: '세션 없음', className: 'detached' }
}

export function presentStatus(state: SessionState): StatusPresentation {
  return TABLE[state]
}
