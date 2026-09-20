import { describe, expect, it } from 'vitest'
import { isUnseenState, mapEvent } from '../src/main/status/mapEvent'

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
      claudeSessionId: 'sess-123'
    })
  })

  it.each(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'])('%s → working', (name) => {
    expect(mapEvent(event(name))).toEqual({ state: 'working', claudeSessionId: null })
  })

  it('PermissionRequest → waiting', () => {
    expect(mapEvent(event('PermissionRequest', { tool_name: 'Bash' }))).toEqual({
      state: 'waiting',
      claudeSessionId: null
    })
  })

  it.each(['Stop', 'StopFailure'])('%s → done', (name) => {
    expect(mapEvent(event(name))).toEqual({ state: 'done', claudeSessionId: null })
  })

  it('SessionEnd → unknown (claudeSessionId는 건드리지 않는다)', () => {
    expect(mapEvent(event('SessionEnd', { reason: 'other' }))).toEqual({
      state: 'unknown',
      claudeSessionId: null
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
        claudeSessionId: null
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
})
