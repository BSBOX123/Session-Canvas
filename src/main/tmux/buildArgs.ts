/**
 * tmux 명령의 인자 배열을 만드는 순수 함수들 (SPEC 5.3).
 *
 * 셸 명령을 문자열로 이어 붙이지 않는다 (SPEC 11). 유일한 예외가 `<launch>`의
 * `-c` 문자열이고, 그래서 이 파일만 인용 처리를 하고 단위 테스트를 둔다.
 */
import type { NodeId } from '../../shared/types'

/** 사용자 기본 tmux 서버·설정과 격리하기 위한 전용 소켓 이름 (SPEC 5.1). */
export const TMUX_SOCKET = 'session-canvas'

export interface TmuxContext {
  /** `-L` 소켓 이름. 테스트에서는 접미사를 붙여 실제 세션과 충돌을 피한다 (SPEC 14.2). */
  socket: string
  /** `-f` 설정 파일 절대경로 (`resources/tmux.conf`). */
  configPath: string
}

/** 노드 1개 = tmux 세션 1개. 세션 이름은 `sc-<nodeId>` (SPEC 5.1). */
export function sessionName(id: NodeId): string {
  return `sc-${id}`
}

/**
 * POSIX 셸용 작은따옴표 인용. 작은따옴표 자체는 `'\''`로 끊어 붙인다.
 * 값 안에 무엇이 들어 있든(공백·따옴표·한글·개행) 한 덩어리로 전달된다.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * `<launch>` 규칙 (SPEC 5.3) — 명령이 끝나도 셸이 남아야 한다.
 *  - command 있음: `$SHELL -l -c '<command>; exec $SHELL -l'`
 *  - 없음: `$SHELL -l`
 *
 * tmux에는 argv 배열로 넘기므로 셸 경로나 cwd는 인용할 필요가 없다.
 * `-c` 문자열 안에서 다시 셸이 되는 부분만 인용한다.
 */
export function buildLaunchArgv(shell: string, command: string | null): string[] {
  if (command === null || command.trim().length === 0) return [shell, '-l']
  return [shell, '-l', '-c', `${command}; exec ${shellQuote(shell)} -l`]
}

/** 모든 호출에 붙는 전역 인자 (SPEC 5.1). */
export function buildGlobalArgs(ctx: TmuxContext): string[] {
  return ['-L', ctx.socket, '-f', ctx.configPath]
}

export interface NewSessionOptions {
  id: NodeId
  cwd: string
  command: string | null
  shell: string
}

/**
 * 생성/재접속 (SPEC 5.3).
 * `-A`: 세션이 이미 있으면 붙기만 한다 (이때 `-c`, `-e`, `<launch>`는 무시된다).
 */
export function buildNewSessionArgs(ctx: TmuxContext, options: NewSessionOptions): string[] {
  return [
    ...buildGlobalArgs(ctx),
    'new-session',
    '-A',
    '-s',
    sessionName(options.id),
    '-c',
    options.cwd,
    // 훅 스크립트가 어느 노드인지 알아내는 통로 (SPEC 8.3).
    '-e',
    `SESSION_CANVAS_NODE_ID=${options.id}`,
    ...buildLaunchArgv(options.shell, options.command)
  ]
}

export function buildHasSessionArgs(ctx: TmuxContext, id: NodeId): string[] {
  return [...buildGlobalArgs(ctx), 'has-session', '-t', sessionName(id)]
}

export function buildKillSessionArgs(ctx: TmuxContext, id: NodeId): string[] {
  return [...buildGlobalArgs(ctx), 'kill-session', '-t', sessionName(id)]
}

export function buildListSessionsArgs(ctx: TmuxContext): string[] {
  return [...buildGlobalArgs(ctx), 'list-sessions', '-F', '#{session_name}\t#{session_path}']
}

export interface TmuxSession {
  id: NodeId
  /** 세션의 현재 작업 폴더. 분리된 세션을 노드로 되살릴 때 쓴다 (SPEC 5.4). */
  cwd: string
}

/** 세션 목록에서 우리 것(`sc-*`)만 골라 노드 id와 폴더로 되돌린다. */
export function parseSessions(stdout: string): TmuxSession[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('sc-'))
    .map((line) => {
      const [name, cwd = ''] = line.split('\t')
      return { id: name.slice('sc-'.length), cwd }
    })
    .filter((session) => session.id.length > 0)
}
