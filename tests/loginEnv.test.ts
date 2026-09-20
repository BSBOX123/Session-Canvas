import { describe, expect, it } from 'vitest'
import { loginShell, parseEnvOutput } from '../src/main/env/loginEnv'

const D = '_SESSION_CANVAS_ENV_'

// SPEC 4.4 — 로그인 셸 환경(특히 PATH)을 정확히 읽어내야 패키징된 앱이
// /opt/homebrew/bin의 tmux, claude를 찾는다.
describe('parseEnvOutput', () => {
  it('구분자 사이의 환경변수만 읽는다', () => {
    const stdout = [
      'zsh: 시작 메시지',
      D,
      'PATH=/opt/homebrew/bin:/usr/bin',
      'SHELL=/bin/zsh',
      D,
      '뒤에 붙은 잡음'
    ].join('\n')

    expect(parseEnvOutput(stdout)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      SHELL: '/bin/zsh'
    })
  })

  it('값에 =가 들어 있어도 첫 =에서만 자른다', () => {
    const stdout = `${D}\nLS_COLORS=di=1;36:ln=35\n${D}`
    expect(parseEnvOutput(stdout).LS_COLORS).toBe('di=1;36:ln=35')
  })

  it('값에 줄바꿈이 있으면 앞 항목에 이어 붙인다', () => {
    const stdout = `${D}\nFUNC=first line\nsecond line\nPATH=/usr/bin\n${D}`
    const env = parseEnvOutput(stdout)
    expect(env.FUNC).toBe('first line\nsecond line')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('빈 값을 허용한다', () => {
    expect(parseEnvOutput(`${D}\nEMPTY=\n${D}`)).toEqual({ EMPTY: '' })
  })

  it('구분자가 없으면 빈 객체를 준다 (현재 환경으로 폴백)', () => {
    expect(parseEnvOutput('PATH=/usr/bin')).toEqual({})
    expect(parseEnvOutput('')).toEqual({})
  })
})

describe('loginShell', () => {
  it('SHELL을 쓴다', () => {
    expect(loginShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
  })

  it('SHELL이 없거나 비어 있으면 macOS 기본값을 쓴다', () => {
    expect(loginShell({})).toBe('/bin/zsh')
    expect(loginShell({ SHELL: '' })).toBe('/bin/zsh')
  })
})
