/**
 * SPEC 4.4 — Finder/Dock에서 실행한 앱은 로그인 셸의 PATH를 물려받지 않는다.
 * 앱 시작 시 `$SHELL -ilc 'env'`를 한 번 실행해 그 환경을 main 프로세스의
 * 기준 환경으로 쓴다. 모든 tmux 호출과 PTY 생성이 이 환경을 쓴다.
 */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DELIMITER = '_SESSION_CANVAS_ENV_'
const TIMEOUT_MS = 5000

/** 로그인 셸이 출력한 `env` 결과를 파싱한다. 순수 함수 — 단위 테스트 대상. */
export function parseEnvOutput(stdout: string): NodeJS.ProcessEnv {
  const start = stdout.indexOf(DELIMITER)
  const end = stdout.lastIndexOf(DELIMITER)
  if (start === -1 || end === start) return {}

  const body = stdout.slice(start + DELIMITER.length, end)
  const env: NodeJS.ProcessEnv = {}
  let lastKey: string | null = null

  for (const line of body.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match) {
      lastKey = match[1]
      env[lastKey] = match[2]
    } else if (lastKey !== null && line !== '') {
      // 줄바꿈이 들어 있는 값(셸 함수 등)은 앞 항목에 이어 붙인다.
      env[lastKey] = `${env[lastKey]}\n${line}`
    }
  }
  return env
}

/** 사용자의 로그인 셸. 없으면 macOS 기본값. */
export function loginShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL && env.SHELL.length > 0 ? env.SHELL : '/bin/zsh'
}

/**
 * 로그인 셸 환경을 읽어 현재 환경과 합친다. 실패하면 현재 환경을 그대로 쓴다
 * (앱이 죽으면 안 된다, SPEC 4.3).
 */
export async function resolveLoginEnv(): Promise<NodeJS.ProcessEnv> {
  const shell = loginShell()
  try {
    const { stdout } = await execFileAsync(
      shell,
      ['-ilc', `echo ${DELIMITER}; env; echo ${DELIMITER}`],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        cwd: homedir(),
        // 로그인 셸이 대화형인 척해야 .zshrc까지 읽는다. 출력이 섞이지 않도록
        // 구분자 사이만 잘라 쓴다.
        env: { ...process.env, TERM: 'dumb' }
      }
    )
    const parsed = parseEnvOutput(stdout)
    if (Object.keys(parsed).length === 0) {
      console.warn('[session-canvas] 로그인 셸 환경을 읽지 못했습니다. 현재 환경을 씁니다.')
      return { ...process.env }
    }
    return { ...process.env, ...parsed }
  } catch (error) {
    console.warn('[session-canvas] 로그인 셸 환경 조회 실패:', error)
    return { ...process.env }
  }
}
