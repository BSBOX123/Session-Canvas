/**
 * 노드별 node-pty 생성·입출력·리사이즈 (SPEC 4.1).
 *
 * PTY는 tmux **클라이언트**를 띄운다 (`tmux new-session -A`). 그래서 PTY를
 * 죽여도 세션은 tmux 서버 안에 살아남는다 (SPEC 5.1/5.3). 인자 조립은
 * `tmux/buildArgs.ts`가 맡는다.
 */
import { spawn, type IPty } from 'node-pty'
import { homedir } from 'node:os'
import type { NodeId } from '../../shared/types'
import type { PtyOpenRequest } from '../../shared/ipc'
import { loginShell } from '../env/loginEnv'
import { buildNewSessionArgs, type TmuxContext } from '../tmux/buildArgs'

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
    private readonly tmux: TmuxContext,
    private readonly handlers: PtyManagerHandlers
  ) {}

  open(req: PtyOpenRequest, cols: number, rows: number): void {
    // 같은 id가 이미 열려 있으면 갈아끼운다. React StrictMode의 이중 마운트나
    // 재접속 요청에서 PTY가 새는 것을 막는다.
    this.detach(req.id)

    const shell = loginShell(this.env)
    const cwd = req.cwd ?? homedir()
    const args = buildNewSessionArgs(this.tmux, {
      id: req.id,
      cwd,
      command: req.command,
      shell
    })

    const pty = spawn('tmux', args, {
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

  /**
   * PTY(= tmux 클라이언트)만 정리한다. tmux 세션과 그 안의 프로세스는
   * 그대로 살아 있다 (SPEC 5.3, 노드 닫기의 기본 동작).
   */
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

  detachAll(): void {
    for (const id of [...this.sessions.keys()]) this.detach(id)
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
