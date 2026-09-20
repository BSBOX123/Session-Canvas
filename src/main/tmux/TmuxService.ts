/**
 * tmux 명령 실행 (SPEC 4.1 / 5.3).
 *
 * 앱은 tmux의 클라이언트일 뿐이고, 실제 프로세스는 tmux 서버가 소유한다.
 * 모든 호출은 전용 소켓 `-L session-canvas`와 전용 설정을 쓴다 (SPEC 5.1).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { NodeId } from '../../shared/types'
import {
  buildHasSessionArgs,
  buildKillSessionArgs,
  buildListSessionsArgs,
  parseSessions,
  type TmuxContext,
  type TmuxSession
} from './buildArgs'

const execFileAsync = promisify(execFile)

/** SPEC 4.3: tmux 3.3+ */
const MIN_VERSION = 3.3
const TIMEOUT_MS = 5000

export interface TmuxVersion {
  ok: boolean
  version: string | null
}

export class TmuxService {
  constructor(
    private readonly ctx: TmuxContext,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('tmux', args, { env: this.env, timeout: TIMEOUT_MS })
  }

  /**
   * 설치 여부와 버전. 앱 시작 시 확인하고, 없거나 낮으면 설치 안내 화면을
   * 띄운다 — 앱이 죽으면 안 된다 (SPEC 4.3).
   */
  async check(): Promise<TmuxVersion> {
    try {
      const { stdout } = await execFileAsync('tmux', ['-V'], {
        env: this.env,
        timeout: TIMEOUT_MS
      })
      const version = stdout.trim().replace(/^tmux\s+/, '')
      // "3.7c", "3.3a", "next-3.4" 같은 표기에서 숫자만 뽑는다.
      const numeric = Number.parseFloat(/(\d+\.\d+)/.exec(version)?.[1] ?? '0')
      return { ok: numeric >= MIN_VERSION, version: version.length > 0 ? version : null }
    } catch {
      return { ok: false, version: null }
    }
  }

  async hasSession(id: NodeId): Promise<boolean> {
    try {
      await this.run(buildHasSessionArgs(this.ctx, id))
      return true
    } catch {
      // 세션이 없거나 서버가 없으면 0이 아닌 종료 코드로 끝난다.
      return false
    }
  }

  /** 서버가 없으면 오류가 나는데, 그건 "세션 없음"과 같다 (SPEC 5.3). */
  async listSessions(): Promise<TmuxSession[]> {
    try {
      const { stdout } = await this.run(buildListSessionsArgs(this.ctx))
      return parseSessions(stdout)
    } catch {
      return []
    }
  }

  async killSession(id: NodeId): Promise<void> {
    try {
      await this.run(buildKillSessionArgs(this.ctx, id))
    } catch {
      // 이미 없는 세션을 죽이는 건 성공과 같다.
    }
  }
}
