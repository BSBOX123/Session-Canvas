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
  /**
   * 백그라운드 작업 개수 (SPEC 8.2). **모르면 `null`.**
   *
   * `Stop`·`StopFailure` 페이로드의 `background_tasks`에서 읽는다. 그 이벤트만
   * 이 값을 들고 오므로, 다른 이벤트에서는 `null`이고 "0개"와 구별해야 한다.
   */
  backgroundTasks: number | null
  /**
   * 해석한 훅 이벤트 이름. `StatusWatcher`가 상태를 합칠 때 쓴다 — 같은
   * `waiting`이라도 `PermissionRequest`(확실히 사람을 기다림)와
   * `Notification`(그냥 유휴 알림일 수 있음)을 구별해야 한다.
   *
   * 렌더러로는 넘기지 않는다. 훅 어휘는 main에 둔다 (SPEC 8.2).
   */
  event: string
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

/**
 * `background_tasks`는 배열로 온다(실측 2026-09-25 / 2.1.280). 배열이 아니면
 * 예전 Claude Code이거나 필드가 빠진 것이므로 **모른다**고 본다.
 */
function backgroundTaskCount(payload: Record<string, unknown>): number | null {
  return Array.isArray(payload.background_tasks) ? payload.background_tasks.length : null
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
      // 세션이 새로 시작하면 이전 백그라운드 작업은 남아 있지 않다.
      return {
        state: 'unknown',
        claudeSessionId: typeof id === 'string' ? id : null,
        backgroundTasks: 0,
        event
      }
    }
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { state: 'working', claudeSessionId: null, backgroundTasks: null, event }
    case 'PermissionRequest':
      return { state: 'waiting', claudeSessionId: null, backgroundTasks: null, event }
    case 'Notification': {
      const state = mapNotification(payload)
      return state === null
        ? null
        : { state, claudeSessionId: null, backgroundTasks: backgroundTaskCount(payload), event }
    }
    case 'Stop':
    case 'StopFailure': {
      // 턴이 끝났지만 백그라운드 작업이 남아 있으면 **끝난 게 아니다.** 그 작업이
      // 끝나면 에이전트가 다시 깨어나므로, 사람이 확인할 일이 아니다 (SPEC 8.1).
      const pending = backgroundTaskCount(payload)
      return {
        state: pending !== null && pending > 0 ? 'background' : 'done',
        claudeSessionId: null,
        backgroundTasks: pending,
        event
      }
    }
    case 'SessionEnd':
      return { state: 'unknown', claudeSessionId: null, backgroundTasks: 0, event }
    default:
      return null
  }
}

/**
 * 기억해 둔 백그라운드 작업 개수를 감안해 최종 상태를 정한다 (SPEC 8.2).
 *
 * 턴이 끝난 뒤 Claude Code가 유휴 `Notification`을 보낼 수 있다. 백그라운드 작업이
 * 남아 있는 동안 그것을 `입력 대기`로 보여 주면 **거짓말이다** — 사람이 할 일은
 * 없고, 작업이 끝나면 에이전트가 스스로 깨어난다.
 *
 * 다만 `PermissionRequest`는 그대로 통과시킨다. 백그라운드 작업 중에도 권한은
 * 사람이 직접 허락해야 하고, 그걸 숨기면 노드가 영원히 멈춘다.
 */
export function resolveState(mapped: MappedEvent, pending: number): SessionState {
  if (pending <= 0) return mapped.state
  if (mapped.state === 'waiting' && mapped.event === 'Notification') return 'background'
  return mapped.state
}

/**
 * `waiting`과 `done`만 unseen 플래그를 갖는다 (SPEC 8.1).
 *
 * `background`는 뺀다 — 사람이 확인할 일이 아니라 진행 상황이다. 배지·알림·`J`
 * 순회에 끼면 정작 나를 기다리는 노드가 묻힌다.
 */
export function isUnseenState(state: SessionState): boolean {
  return state === 'waiting' || state === 'done'
}
