/** SPEC 10 IPC 계약. 채널 이름과 페이로드 타입은 여기서만 정의한다. */
import type { NodeId, SessionState, TerminalNodeData, Workspace } from './types'

export const CHANNELS = {
  ptyOpen: 'pty:open',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyDetach: 'pty:detach',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  dialogPickDirectory: 'dialog:pickDirectory',
  workspaceLoad: 'workspace:load',
  workspaceSave: 'workspace:save',
  tmuxCheck: 'tmux:check',
  tmuxExists: 'tmux:exists',
  tmuxListOrphans: 'tmux:listOrphans',
  statusChanged: 'status:changed',
  statusSetKnownNodes: 'status:setKnownNodes',
  hooksState: 'hooks:state',
  hooksInstall: 'hooks:install',
  hooksUninstall: 'hooks:uninstall',
  appSetBadge: 'app:setBadge',
  appNotify: 'app:notify',
  appNotificationClick: 'app:notificationClick',
  appSetNotifications: 'app:setNotifications'
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

/**
 * SPEC 9.2의 복구 경로를 renderer가 알아야 해서 `Workspace`만 주지 않고
 * 상태를 함께 준다 (SPEC 10 개정 v0.1.5).
 */
export interface WorkspaceLoadResult {
  workspace: Workspace
  status: 'ok' | 'empty' | 'recovered-from-backup' | 'corrupt' | 'unsupported-version'
  message: string | null
}

export interface WorkspaceApi {
  load(): Promise<WorkspaceLoadResult>
  /** main에서 500ms 디바운스 후 원자적으로 쓴다 (SPEC 9.2). */
  save(workspace: Workspace): void
}

export interface OrphanSession {
  id: NodeId
  cwd: string
}

export interface TmuxApi {
  check(): Promise<{ ok: boolean; version: string | null }>
  /** 워크스페이스에 없는 `sc-*` 세션들 (SPEC 5.4). */
  listOrphans(known: NodeId[]): Promise<OrphanSession[]>
  exists(id: NodeId): Promise<boolean>
}

/** SPEC 8.2가 해석한 결과. `NodeStatus`의 unseen은 renderer가 관리한다. */
export interface StatusChange {
  nodeId: NodeId
  state: SessionState
  at: string
  claudeSessionId: string | null
}

export interface StatusApi {
  onChange(cb: (change: StatusChange) => void): Unsubscribe
  /** 워크스페이스에 없는 노드의 상태 파일은 무시한다 (SPEC 8.5). */
  setKnownNodes(ids: NodeId[]): void
}

export type HookInstallState = 'installed' | 'not-installed' | 'outdated'

export interface HooksApi {
  state(): Promise<HookInstallState>
  /**
   * ⚠️ `~/.claude/settings.json`을 고친다. 앱 UI에서 사용자 동의를 받은
   * 뒤에만 부른다 (SPEC 0.4 / 8.4). 원본은 백업된다.
   */
  install(): Promise<{ backup: string | null }>
  uninstall(): Promise<{ backup: string | null }>
}

export interface AppApi {
  setBadge(n: number): void
  /** 알림은 renderer가 "보여야 하는 상황인지" 판단한 뒤 요청한다 (SPEC 8.6). */
  notify(nodeId: NodeId, title: string, state: SessionState): void
  setNotificationsEnabled(enabled: boolean): void
  onNotificationClick(cb: (nodeId: NodeId) => void): Unsubscribe
}

export interface DialogApi {
  /** 디렉터리 선택 창. 취소하면 null (SPEC 7.2). */
  pickDirectory(): Promise<string | null>
}

export interface Api {
  pty: PtyApi
  workspace: WorkspaceApi
  tmux: TmuxApi
  status: StatusApi
  hooks: HooksApi
  app: AppApi
  dialog: DialogApi
}
