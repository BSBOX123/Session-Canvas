/** SPEC 10 IPC 계약. 채널 이름과 페이로드 타입은 여기서만 정의한다. */
import type { NodeId, TerminalNodeData } from './types'

export const CHANNELS = {
  ptyOpen: 'pty:open',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyDetach: 'pty:detach',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  dialogPickDirectory: 'dialog:pickDirectory'
} as const

/**
 * main이 PTY를 여는 데 실제로 필요한 것만 받는다 (SPEC 11: IPC 입력 검증).
 * `cwd`가 null이면 main이 홈 디렉터리를 쓴다.
 */
export type PtyOpenRequest = Pick<TerminalNodeData, 'id' | 'command'> & {
  cwd: string | null
}

export interface PtyDataPayload {
  id: NodeId
  data: string
}

export interface PtyExitPayload {
  id: NodeId
  code: number
}

export type Unsubscribe = () => void

/** 단계 1 범위. workspace/status/tmux/hooks/dialog/app은 단계 3~6에서 추가된다. */
export interface PtyApi {
  open(req: PtyOpenRequest, cols: number, rows: number): Promise<void>
  write(id: NodeId, data: string): void
  resize(id: NodeId, cols: number, rows: number): void
  /** PTY만 종료한다. 단계 3부터는 tmux 세션이 살아남는다. */
  detach(id: NodeId): Promise<void>
  /** 세션을 완전히 끝낸다. 단계 3부터 `tmux kill-session`. */
  kill(id: NodeId): Promise<void>
  onData(cb: (id: NodeId, data: string) => void): Unsubscribe
  onExit(cb: (id: NodeId, code: number) => void): Unsubscribe
}

export interface DialogApi {
  /** 디렉터리 선택 창. 취소하면 null (SPEC 7.2). */
  pickDirectory(): Promise<string | null>
}

export interface Api {
  pty: PtyApi
  dialog: DialogApi
}
