import { describe, expect, it } from 'vitest'
import { isUnseenState, mapEvent, resolveState } from '../src/main/status/mapEvent'

const base = {
  session_id: 'sess-123',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/Users/me/dev'
}

const event = (name: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...base, hook_event_name: name, ...extra })

// SPEC 8.2 — 표의 모든 이벤트. 실제 stdin 덤프(2.1.278)에서 확인한 필드를 쓴다.
describe('mapEvent', () => {
  it('SessionStart → unknown, session_id를 claudeSessionId로 넘긴다', () => {
    expect(mapEvent(event('SessionStart', { source: 'startup' }))).toEqual({
      state: 'unknown',
      claudeSessionId: 'sess-123',
      backgroundTasks: 0,
      event: 'SessionStart'
    })
  })

  it.each(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'])('%s → working', (name) => {
    expect(mapEvent(event(name))).toEqual({
      state: 'working',
      claudeSessionId: null,
      backgroundTasks: null,
      event: name
    })
  })

  it('PermissionRequest → waiting', () => {
    expect(mapEvent(event('PermissionRequest', { tool_name: 'Bash' }))).toEqual({
      state: 'waiting',
      claudeSessionId: null,
      backgroundTasks: null,
      event: 'PermissionRequest'
    })
  })

  it.each(['Stop', 'StopFailure'])('%s → done (백그라운드 작업이 없을 때)', (name) => {
    expect(mapEvent(event(name, { background_tasks: [] }))).toEqual({
      state: 'done',
      claudeSessionId: null,
      backgroundTasks: 0,
      event: name
    })
  })

  // 실측: Stop 페이로드에 `background_tasks` 배열이 온다 (2026-09-25 / 2.1.280).
  it.each(['Stop', 'StopFailure'])(
    '%s + 백그라운드 작업이 남아 있으면 → background (완료가 아니다)',
    (name) => {
      expect(mapEvent(event(name, { background_tasks: [{ id: 'bk1' }] }))).toEqual({
        state: 'background',
        claudeSessionId: null,
        backgroundTasks: 1,
        event: name
      })
    }
  )

  it('background_tasks 필드가 없으면 예전처럼 done으로 본다', () => {
    // 예전 Claude Code이거나 필드가 빠진 경우. "0개"라고 단정하지 않는다.
    expect(mapEvent(event('Stop'))).toEqual({
      state: 'done',
      claudeSessionId: null,
      backgroundTasks: null,
      event: 'Stop'
    })
  })

  it('SessionEnd → unknown (claudeSessionId는 건드리지 않는다)', () => {
    expect(mapEvent(event('SessionEnd', { reason: 'other' }))).toEqual({
      state: 'unknown',
      claudeSessionId: null,
      backgroundTasks: 0,
      event: 'SessionEnd'
    })
  })

  describe('Notification', () => {
    it.each(['permission_prompt', 'idle_prompt', 'agent_needs_input'])(
      '%s → waiting',
      (notification_type) => {
        expect(mapEvent(event('Notification', { notification_type }))?.state).toBe('waiting')
      }
    )

    it.each(['auth_success', 'elicitation_dialog', 'quota_auto_resume_fired'])(
      '%s는 무시한다 (사용자가 볼 일이 아니다)',
      (notification_type) => {
        expect(mapEvent(event('Notification', { notification_type }))).toBeNull()
      }
    )

    // notification_type은 문서에만 있고 실측하지 못했다. 필드명이 바뀌거나
    // 없더라도 "입력 대기"를 놓치지 않는 쪽으로 기운다.
    it('종류를 알 수 없으면 waiting으로 본다', () => {
      expect(mapEvent(event('Notification'))?.state).toBe('waiting')
      expect(mapEvent(event('Notification', { notification_type: 42 }))?.state).toBe('waiting')
      expect(mapEvent(event('Notification', { message: '뭔가 새 필드' }))?.state).toBe('waiting')
    })
  })

  describe('망가진 입력', () => {
    it('모르는 이벤트는 무시한다', () => {
      expect(mapEvent(event('SomeFutureEvent'))).toBeNull()
      expect(mapEvent(event('PreCompact'))).toBeNull()
    })

    it('깨진 JSON·이상한 값에도 던지지 않는다', () => {
      expect(mapEvent('{깨짐')).toBeNull()
      expect(mapEvent('')).toBeNull()
      expect(mapEvent('null')).toBeNull()
      expect(mapEvent('[]')).toBeNull()
      expect(mapEvent('"문자열"')).toBeNull()
      expect(mapEvent('{"hook_event_name": 123}')).toBeNull()
      expect(mapEvent('{}')).toBeNull()
    })

    it('SessionStart에 session_id가 없어도 상태는 준다', () => {
      expect(mapEvent('{"hook_event_name":"SessionStart"}')).toEqual({
        state: 'unknown',
        claudeSessionId: null,
        backgroundTasks: 0,
        event: 'SessionStart'
      })
    })
  })
})

describe('isUnseenState (SPEC 8.1)', () => {
  it('waiting과 done만 unseen을 갖는다', () => {
    expect(isUnseenState('waiting')).toBe(true)
    expect(isUnseenState('done')).toBe(true)
    expect(isUnseenState('working')).toBe(false)
    expect(isUnseenState('unknown')).toBe(false)
    expect(isUnseenState('detached')).toBe(false)
  })

  it('background는 unseen이 아니다 — 확인할 일이 아니라 진행 상황이다', () => {
    expect(isUnseenState('background')).toBe(false)
  })
})

// SPEC 8.2 — 턴이 끝난 뒤의 유휴 알림을 "입력 대기"로 착각하지 않는다.
describe('resolveState (SPEC 8.2)', () => {
  const notification = mapEvent(event('Notification', { notification_type: 'idle_prompt' }))
  const permission = mapEvent(event('PermissionRequest', { tool_name: 'Bash' }))

  it('백그라운드 작업이 남아 있으면 유휴 Notification을 background로 본다', () => {
    expect(notification).not.toBeNull()
    expect(resolveState(notification!, 1)).toBe('background')
  })

  it('백그라운드 작업이 없으면 그대로 waiting이다', () => {
    expect(resolveState(notification!, 0)).toBe('waiting')
  })

  it('PermissionRequest는 백그라운드 중에도 통과한다 — 숨기면 노드가 멈춘다', () => {
    expect(permission).not.toBeNull()
    expect(resolveState(permission!, 3)).toBe('waiting')
  })

  it('working·done은 백그라운드 개수와 무관하다', () => {
    const working = mapEvent(event('PreToolUse'))
    expect(resolveState(working!, 2)).toBe('working')
  })
})
