/**
 * 노드별 node-pty 생성·입출력·리사이즈 (SPEC 4.1).
 *
 * 단계 1에서는 tmux 없이 로그인 셸을 직접 띄운다. 단계 3에서 spawn 대상이
 * `tmux new-session -A ...`로 바뀌고 인자 조립은 `tmux/buildArgs.ts`가 맡는다.
 */
import { spawn, type IPty } from 'node-pty'
import { homedir } from 'node:os'
import type { NodeId } from '../../shared/types'
import type { PtyOpenRequest } from '../../shared/ipc'
import { loginShell } from '../env/loginEnv'

/** SPEC 10: PTY 출력은 노드별로 약 8ms 단위로 묶어 보낸다. */
const FLUSH_INTERVAL_MS = 8

interface Session {
  pty: IPty
  buffer: string[]
  flushTimer: NodeJS.Timeout | null
}

export interface PtyManagerHandlers {
  onData(id: NodeId, data: string): void
  onExit(id: NodeId, code: number): void
}

export class PtyManager {
  private readonly sessions = new Map<NodeId, Session>()

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly handlers: PtyManagerHandlers
  ) {}

  open(req: PtyOpenRequest, cols: number, rows: number): void {
    // 같은 id가 이미 열려 있으면 갈아끼운다. React StrictMode의 이중 마운트나
    // 재접속 요청에서 PTY가 새는 것을 막는다.
    this.detach(req.id)

    const shell = loginShell(this.env)
    const cwd = req.cwd ?? homedir()
    const args = req.command === null ? ['-l'] : this.launchArgs(shell, req.command)

    const pty = spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...this.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // UTF-8이 아니면 한글이 깨진다 (SPEC 4.4).
        LANG: this.env.LANG ?? 'ko_KR.UTF-8'
      }
    })

    const session: Session = { pty, buffer: [], flushTimer: null }
    this.sessions.set(req.id, session)

    // 이벤트에는 자기 session을 함께 들고 다닌다. 교체 직후에는 이전 PTY의
    // data/exit이 뒤늦게 도착하는데, id만 보면 새 세션의 출력으로 오인하거나
    // 새 세션을 맵에서 지워버린다 (StrictMode 이중 마운트에서 실제로 발생).
    pty.onData((data) => this.push(req.id, session, data))
    pty.onExit(({ exitCode }) => {
      if (this.sessions.get(req.id) !== session) return
      this.flush(req.id)
      this.dispose(req.id)
      this.handlers.onExit(req.id, exitCode)
    })
  }

  write(id: NodeId, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: NodeId, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.pty.resize(cols, rows)
    } catch (error) {
      // 이미 종료된 PTY에 resize하면 던진다. 앱이 죽으면 안 된다.
      console.warn(`[session-canvas] resize 실패 (${id}):`, error)
    }
  }

  /** PTY만 정리한다. 단계 3부터는 tmux 세션이 살아남는다 (SPEC 5.3). */
  detach(id: NodeId): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.dispose(id)
    try {
      session.pty.kill()
    } catch {
      /* 이미 죽었다 */
    }
  }

  /**
   * 세션을 완전히 끝낸다. 단계 1에서는 tmux가 없어 detach와 같다.
   * 단계 3에서 `tmux kill-session`이 앞에 붙는다.
   */
  kill(id: NodeId): void {
    this.detach(id)
  }

  detachAll(): void {
    for (const id of [...this.sessions.keys()]) this.detach(id)
  }

  private launchArgs(shell: string, command: string): string[] {
    // 명령이 끝나도 셸이 남아야 한다 (SPEC 5.3). 따옴표 이스케이프를 포함한
    // 정식 조립과 단위 테스트는 단계 3의 `tmux/buildArgs.ts`에서 한다.
    return ['-l', '-c', `${command}; exec ${shell} -l`]
  }

  private push(id: NodeId, session: Session, data: string): void {
    if (this.sessions.get(id) !== session) return
    session.buffer.push(data)
    if (session.flushTimer === null) {
      session.flushTimer = setTimeout(() => this.flush(id), FLUSH_INTERVAL_MS)
    }
  }

  private flush(id: NodeId): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    if (session.buffer.length === 0) return
    const data = session.buffer.join('')
    session.buffer.length = 0
    this.handlers.onData(id, data)
  }

  private dispose(id: NodeId): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.flushTimer !== null) clearTimeout(session.flushTimer)
    this.sessions.delete(id)
  }
}
