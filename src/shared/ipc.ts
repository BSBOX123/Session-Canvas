/** SPEC 10 IPC 계약. 채널 이름과 페이로드 타입은 여기서만 정의한다. */
import type { AgentKind, NodeId, SessionState, Workspace } from './types'

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
  appSetNotifications: 'app:setNotifications',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  gitBranch: 'git:branch',
  workLogGet: 'workLog:get'
} as const

/**
 * main이 PTY를 여는 데 실제로 필요한 것만 받는다 (SPEC 11: IPC 입력 검증).
 * `cwd`가 null이면 main이 홈 디렉터리를 쓴다.
 */
export type PtyOpenRequest = {
  id: NodeId
  command: string | null
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
  agentSessionId: string | null
  /** 남은 백그라운드 작업 개수. 이 이벤트로는 알 수 없으면 `null` (SPEC 8.2). */
  backgroundTasks: number | null
  /** 에이전트가 알려 준 transcript 경로 (SPEC 16.1). 경로를 계산하지 않는다. */
  transcriptPath: string | null
}

export interface StatusApi {
  onChange(cb: (change: StatusChange) => void): Unsubscribe
  /** 워크스페이스에 없는 노드의 상태 파일은 무시한다 (SPEC 8.5). */
  setKnownNodes(ids: NodeId[]): void
}

export type HookInstallState = 'installed' | 'not-installed' | 'outdated'

/** 설치 결과. `needsApproval`이면 사용자가 더 할 일이 있다 (SPEC 21.2). */
export interface HookInstallResult {
  backup: string | null
  /** Codex는 파일을 고쳐도 `/hooks`로 승인해야 훅이 돈다. */
  needsApproval: boolean
}

export interface HooksApi {
  state(agent: AgentKind): Promise<HookInstallState>
  /**
   * ⚠️ 그 에이전트의 **사용자 전역 설정**을 고친다 (Claude Code는
   * `~/.claude/settings.json`, Codex는 `~/.codex/hooks.json`). 앱 UI에서
   * 사용자 동의를 받은 뒤에만 부른다 (SPEC 0.4 / 8.4). 원본은 백업된다.
   */
  install(agent: AgentKind): Promise<HookInstallResult>
  uninstall(agent: AgentKind): Promise<HookInstallResult>
}

export interface AppApi {
  setBadge(n: number): void
  /** 알림은 renderer가 "보여야 하는 상황인지" 판단한 뒤 요청한다 (SPEC 8.6). */
  notify(nodeId: NodeId, title: string, state: SessionState): void
  setNotificationsEnabled(enabled: boolean): void
  onNotificationClick(cb: (nodeId: NodeId) => void): Unsubscribe
}

/**
 * 터미널 복사·붙여넣기 (SPEC 7.5의 `Cmd+C`/`Cmd+V`).
 * xterm의 선택은 DOM 선택이 아니라서 브라우저 기본 동작으로는 복사되지 않고,
 * `navigator.clipboard`는 권한에 걸릴 수 있어 Electron의 클립보드를 쓴다.
 */
export interface ClipboardApi {
  read(): Promise<string>
  write(text: string): void
}

export interface GitApi {
  /** 저장소가 아니면 null. 헤더의 `경로 · 브랜치` 표시에 쓴다 (SPEC 7.1). */
  branch(cwd: string): Promise<string | null>
}

/**
 * 노드 하나의 작업 기록 (SPEC 16 / 19 단계 8).
 *
 * **의도는 transcript, 결과는 git**이다 (SPEC 16.2). 둘을 한 번에 돌려줘서
 * 렌더러가 두 번 묻지 않게 한다.
 */
export interface WorkLogView {
  /** 세션 시작 시 주제. 빈 제목을 채우는 데 쓴다. 없으면 null (SPEC 16.1). */
  title: string | null
  /** "지금 무엇을 하는 중인가" — 가장 최근 프롬프트 한 줄. */
  activity: string | null
  /** 최근이 앞. 시킨 것과 한 것이 섞여 시간순으로 온다. */
  timeline: WorkLogEntry[]
  /** 도구별 호출 횟수 (전체 누적). */
  toolCounts: Record<string, number>
  /** git이 본 변경. 저장소가 아니면 `root`가 null이다 (SPEC 16.2). */
  changes: { root: string | null; files: ChangedFileView[]; truncated: boolean }
  /**
   * transcript를 못 읽었는가. 기록이 **없는 것**과 **못 읽은 것**은 다르다 —
   * UI가 구별해서 보여 줘야 한다 (SPEC 16.3).
   */
  transcriptMissing: boolean
}

export interface WorkLogEntry {
  kind: 'prompt' | 'tool'
  at: string | null
  /** 프롬프트면 첫 줄, 도구면 도구 이름. */
  text: string
  /** 도구일 때만. 무엇에 썼는지 한 줄 요약 (파일 경로나 명령 앞부분). */
  detail: string | null
}

export interface ChangedFileView {
  path: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
}

/**
 * 작업 기록 요청 (SPEC 10).
 *
 * **renderer가 노드 값을 실어 보낸다.** main의 `WorkspaceStore`는 지연 저장이라
 * 최신이 아닐 수 있다 — 첫 변화가 있을 때까지 디스크에 안 써진다(HANDOVER 8-4).
 * 그걸 읽으면 조용히 낡은 경로를 쓰게 된다.
 */
export interface WorkLogRequest {
  nodeId: NodeId
  cwd: string
  agentSessionId: string | null
  transcriptPath: string | null
}

export interface WorkLogApi {
  /** 그 노드의 작업 기록. 값이 잘못되면 null. */
  get(req: WorkLogRequest): Promise<WorkLogView | null>
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
  clipboard: ClipboardApi
  git: GitApi
  workLog: WorkLogApi
  dialog: DialogApi
}
