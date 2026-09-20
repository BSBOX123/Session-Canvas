import { describe, expect, it } from 'vitest'
import {
  buildHasSessionArgs,
  buildKillSessionArgs,
  buildLaunchArgv,
  buildListSessionsArgs,
  buildNewSessionArgs,
  parseSessions,
  sessionName,
  shellQuote,
  type TmuxContext
} from '../src/main/tmux/buildArgs'

const ctx: TmuxContext = { socket: 'session-canvas', configPath: '/app/resources/tmux.conf' }
const base = { id: 'abc123XY_-', cwd: '/Users/me/dev', command: null, shell: '/bin/zsh' }

describe('sessionName', () => {
  it('노드 1개 = 세션 sc-<id> (SPEC 5.1)', () => {
    expect(sessionName('abc123XY_-')).toBe('sc-abc123XY_-')
  })
})

describe('shellQuote', () => {
  it('공백·한글·따옴표가 들어가도 한 덩어리로 묶는다', () => {
    expect(shellQuote('/Users/me/내 프로젝트')).toBe(`'/Users/me/내 프로젝트'`)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('a "b" c')).toBe(`'a "b" c'`)
  })
})

describe('buildLaunchArgv (SPEC 5.3)', () => {
  it('command가 없으면 로그인 셸만 띄운다', () => {
    expect(buildLaunchArgv('/bin/zsh', null)).toEqual(['/bin/zsh', '-l'])
    expect(buildLaunchArgv('/bin/zsh', '   ')).toEqual(['/bin/zsh', '-l'])
  })

  it('command가 끝나도 셸이 남는다', () => {
    expect(buildLaunchArgv('/bin/zsh', 'claude')).toEqual([
      '/bin/zsh',
      '-l',
      '-c',
      `claude; exec '/bin/zsh' -l`
    ])
  })

  it('셸 경로에 공백이 있어도 exec가 깨지지 않는다', () => {
    const [, , , script] = buildLaunchArgv('/opt/my shell/zsh', 'claude')
    expect(script).toBe(`claude; exec '/opt/my shell/zsh' -l`)
  })

  it('command 안의 따옴표는 사용자가 쓴 그대로 셸에 간다', () => {
    const [, , , script] = buildLaunchArgv('/bin/zsh', `echo "hi there"`)
    expect(script).toBe(`echo "hi there"; exec '/bin/zsh' -l`)
  })
})

describe('buildNewSessionArgs (SPEC 5.3)', () => {
  it('전역 인자로 전용 소켓과 설정 파일을 붙인다 (SPEC 5.1)', () => {
    const args = buildNewSessionArgs(ctx, base)
    expect(args.slice(0, 4)).toEqual(['-L', 'session-canvas', '-f', '/app/resources/tmux.conf'])
  })

  it('-A로 붙고, 세션 이름·cwd·노드 id 환경변수를 넘긴다', () => {
    expect(buildNewSessionArgs(ctx, base)).toEqual([
      '-L',
      'session-canvas',
      '-f',
      '/app/resources/tmux.conf',
      'new-session',
      '-A',
      '-s',
      'sc-abc123XY_-',
      '-c',
      '/Users/me/dev',
      '-e',
      'SESSION_CANVAS_NODE_ID=abc123XY_-',
      '/bin/zsh',
      '-l'
    ])
  })

  // 인자 배열로 넘기므로 cwd는 인용이 필요 없다 — 오히려 인용하면 깨진다.
  it('공백·한글이 든 cwd를 그대로 한 인자로 넘긴다', () => {
    const args = buildNewSessionArgs(ctx, { ...base, cwd: '/Users/me/내 프로젝트 (백업)' })
    expect(args[args.indexOf('-c') + 1]).toBe('/Users/me/내 프로젝트 (백업)')
  })

  it('command가 있으면 launch가 뒤에 붙는다', () => {
    const args = buildNewSessionArgs(ctx, { ...base, command: 'claude --resume' })
    expect(args.slice(-4)).toEqual(['/bin/zsh', '-l', '-c', `claude --resume; exec '/bin/zsh' -l`])
  })
})

describe('나머지 명령', () => {
  it('has-session / kill-session / list-sessions', () => {
    expect(buildHasSessionArgs(ctx, 'abc')).toEqual([
      '-L',
      'session-canvas',
      '-f',
      '/app/resources/tmux.conf',
      'has-session',
      '-t',
      'sc-abc'
    ])
    expect(buildKillSessionArgs(ctx, 'abc').slice(-3)).toEqual(['kill-session', '-t', 'sc-abc'])
    expect(buildListSessionsArgs(ctx).slice(-3)).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_path}'
    ])
  })
})

describe('parseSessions', () => {
  it('우리 세션만 골라 노드 id와 폴더로 되돌린다', () => {
    expect(parseSessions('sc-abc\t/Users/me/dev\nsc-def\t/tmp\nmy-own\t/x\n')).toEqual([
      { id: 'abc', cwd: '/Users/me/dev' },
      { id: 'def', cwd: '/tmp' }
    ])
  })

  it('폴더에 공백·한글이 있어도 탭 하나만 자른다', () => {
    expect(parseSessions('sc-abc\t/Users/me/내 프로젝트 (백업)')).toEqual([
      { id: 'abc', cwd: '/Users/me/내 프로젝트 (백업)' }
    ])
  })

  it('서버가 없어 빈 출력이어도 빈 목록', () => {
    expect(parseSessions('')).toEqual([])
    expect(parseSessions('\n\n')).toEqual([])
  })
})
