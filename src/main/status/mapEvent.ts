/**
 * 훅 이벤트 → 노드 상태 (SPEC 8.2). 순수 함수 — 단위 테스트 대상.
 *
 * 표는 공식 문서 + 실제 stdin 덤프로 확인했다 (R1, 2026-09-20 / 2.1.278).
 * 모르는 이벤트는 무시한다 — 앱이 죽으면 안 된다.
 */
import type { SessionState } from '../../shared/types'

/** 훅이 저장한 파일을 해석한 결과. */
export interface MappedEvent {
  state: SessionState
  /** `SessionStart`에서만 채워진다 (resume용, SPEC 5.4). */
  claudeSessionId: string | null
}

/**
 * 사용자가 봐야 하는 상황이 아닌 알림들. 이 목록에 없는 종류는 `waiting`으로
 * 본다 — 놓치는 것보다 한 번 더 알리는 쪽이 낫고, 필드 자체가 없을 수도 있다.
 */
const IGNORED_NOTIFICATIONS = new Set(['auth_success'])
const IGNORED_NOTIFICATION_PREFIXES = ['elicitation_', 'quota_']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapNotification(payload: Record<string, unknown>): SessionState | null {
  const type = payload.notification_type
  if (typeof type !== 'string') return 'waiting'
  if (IGNORED_NOTIFICATIONS.has(type)) return null
  if (IGNORED_NOTIFICATION_PREFIXES.some((prefix) => type.startsWith(prefix))) return null
  return 'waiting'
}

/**
 * 훅이 남긴 JSON 문자열을 해석한다. 깨진 JSON·모르는 이벤트는 `null`.
 */
export function mapEvent(raw: string): MappedEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(payload)) return null

  const event = payload.hook_event_name
  if (typeof event !== 'string') return null

  switch (event) {
    case 'SessionStart': {
      const id = payload.session_id
      return { state: 'unknown', claudeSessionId: typeof id === 'string' ? id : null }
    }
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { state: 'working', claudeSessionId: null }
    case 'PermissionRequest':
      return { state: 'waiting', claudeSessionId: null }
    case 'Notification': {
      const state = mapNotification(payload)
      return state === null ? null : { state, claudeSessionId: null }
    }
    case 'Stop':
    case 'StopFailure':
      return { state: 'done', claudeSessionId: null }
    case 'SessionEnd':
      return { state: 'unknown', claudeSessionId: null }
    default:
      return null
  }
}

/** `waiting`과 `done`만 unseen 플래그를 갖는다 (SPEC 8.1). */
export function isUnseenState(state: SessionState): boolean {
  return state === 'waiting' || state === 'done'
}
