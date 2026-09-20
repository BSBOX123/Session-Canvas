import { describe, expect, it } from 'vitest'
import { HOOK_EVENTS, installState, withHooks, withoutHooks } from '../src/main/hooks/mergeSettings'

const CMD = '/Users/me/.session-canvas/bin/session-canvas-hook.sh'
const OTHER = '/Users/me/bin/my-own-hook.sh'

/** 사용자가 이미 쓰고 있던 설정. 한 글자도 바뀌면 안 된다. */
function userSettings(): Record<string, unknown> {
  return {
    model: 'claude-opus-5',
    permissions: { allow: ['Bash(npm run *)'] },
    env: { FOO: 'bar' },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: OTHER, timeout: 30 }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: OTHER }] }]
    }
  }
}

describe('withHooks (SPEC 8.4)', () => {
  it('빈 설정에 모든 이벤트를 건다', () => {
    const result = withHooks({}, CMD)
    const hooks = result.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort())
    expect(hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: CMD, timeout: 5 }] }])
  })

  it('명령 경로는 절대경로 그대로 쓴다 (~ 금지)', () => {
    const hooks = withHooks({}, CMD).hooks as Record<string, { hooks: { command: string }[] }[]>
    for (const event of HOOK_EVENTS) {
      expect(hooks[event][0].hooks[0].command).toBe(CMD)
      expect(hooks[event][0].hooks[0].command.startsWith('/')).toBe(true)
    }
  })

  it('사용자의 기존 hooks와 다른 설정을 보존한다', () => {
    const before = userSettings()
    const result = withHooks(before, CMD)

    expect(result.model).toBe('claude-opus-5')
    expect(result.permissions).toEqual({ allow: ['Bash(npm run *)'] })
    expect(result.env).toEqual({ FOO: 'bar' })

    const preToolUse = (result.hooks as Record<string, unknown[]>).PreToolUse
    expect(preToolUse[0]).toEqual({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: OTHER, timeout: 30 }]
    })
    expect(preToolUse).toHaveLength(2)
  })

  it('입력 객체를 바꾸지 않는다', () => {
    const before = userSettings()
    const snapshot = JSON.stringify(before)
    withHooks(before, CMD)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('멱등하다 — 두 번 설치해도 1개', () => {
    const once = withHooks(userSettings(), CMD)
    const twice = withHooks(once, CMD)
    expect(twice).toEqual(once)

    const stop = (twice.hooks as Record<string, unknown[]>).Stop
    expect(stop).toHaveLength(1)
  })

  it('이벤트가 늘어난 경우 빠진 것만 채운다', () => {
    const partial = withHooks({}, CMD)
    delete (partial.hooks as Record<string, unknown>).StopFailure

    const filled = withHooks(partial, CMD)
    expect((filled.hooks as Record<string, unknown[]>).StopFailure).toHaveLength(1)
    expect((filled.hooks as Record<string, unknown[]>).Stop).toHaveLength(1)
  })
})

describe('withoutHooks (SPEC 8.4)', () => {
  it('우리 항목만 지우고 사용자 것은 남긴다', () => {
    const installed = withHooks(userSettings(), CMD)
    const removed = withoutHooks(installed, CMD)

    expect(removed).toEqual(userSettings())
  })

  it('한 그룹에 우리 것과 사용자 것이 섞여 있으면 우리 것만 뺀다', () => {
    const mixed = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: OTHER },
              { type: 'command', command: CMD, timeout: 5 }
            ]
          }
        ]
      }
    }
    expect(withoutHooks(mixed, CMD)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: OTHER }] }] }
    })
  })

  it('우리 것만 있던 설정에서는 hooks 키 자체가 사라진다', () => {
    const only = withHooks({ model: 'x' }, CMD)
    expect(withoutHooks(only, CMD)).toEqual({ model: 'x' })
  })

  it('설치된 적 없으면 아무것도 바꾸지 않는다', () => {
    expect(withoutHooks(userSettings(), CMD)).toEqual(userSettings())
    expect(withoutHooks({}, CMD)).toEqual({})
  })
})

describe('installState', () => {
  it('없음 / 전부 / 일부', () => {
    expect(installState({}, CMD)).toBe('not-installed')
    expect(installState(userSettings(), CMD)).toBe('not-installed')
    expect(installState(withHooks({}, CMD), CMD)).toBe('installed')

    const partial = withHooks({}, CMD)
    delete (partial.hooks as Record<string, unknown>).SessionEnd
    expect(installState(partial, CMD)).toBe('outdated')
  })

  it('다른 명령이 걸려 있어도 우리 것으로 세지 않는다', () => {
    const someoneElse = withHooks({}, OTHER)
    expect(installState(someoneElse, CMD)).toBe('not-installed')
  })
})
