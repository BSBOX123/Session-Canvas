/** SPEC 9.1 데이터 모델. */

/** nanoid(10) 형식. `[A-Za-z0-9_-]`만 허용한다 (경로 조작 방지, SPEC 8.3/11). */
export type NodeId = string

export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** SPEC 11: IPC로 넘어온 명령 문자열 길이 제한. */
export const MAX_COMMAND_LENGTH = 512

/**
 * 캔버스에 올라가는 노드의 종류 (SPEC 18.2).
 *
 * 지금은 터미널 하나뿐이다. 종류를 늘리는 것이 v2의 목적이고, 여기서는
 * **늘릴 자리만** 만든다.
 */
export type NodeKind = 'terminal'

/**
 * 종류와 무관하게 모든 노드가 갖는 것 (SPEC 18.2).
 *
 * 이동·리사이즈·선택·저장을 다루는 코드는 이것만 알면 되고, 종류가 늘어도
 * 바뀌지 않아야 한다.
 */
export interface BaseNodeData {
  id: NodeId
  kind: NodeKind
  title: string // 빈 문자열 허용 → UI에서 폴더명 표시
  description: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  /** 레이어 순서 (SPEC 17.3). 단계 11에서 쓴다. */
  z: number
  /** 프레임(그룹) 부모 (SPEC 17.2). 단계 11에서 쓴다. */
  parentId: NodeId | null
  color: string | null
  locked: boolean
  hidden: boolean
  createdAt: string // ISO 8601
  updatedAt: string
}

/** 터미널 노드만 갖는 것 (SPEC 18.2). */
export interface TerminalPayload {
  cwd: string // 절대경로
  command: string | null // 기본 "claude", null이면 셸만
  tmuxSession: string // `sc-${id}`
  claudeSessionId: string | null
}

export type TerminalNodeData = BaseNodeData & {
  kind: 'terminal'
  terminal: TerminalPayload
}

/** 캔버스가 다루는 노드. 종류가 늘면 여기에 더한다. */
export type CanvasNode = TerminalNodeData

/** 종류를 좁히는 데 쓴다. */
export function isTerminalNode(node: CanvasNode): node is TerminalNodeData {
  return node.kind === 'terminal'
}

/** 화면 테마 (SPEC 9.1). `preset`은 배경 계열, `accent`는 강조색. */
export interface ThemeSettings {
  preset: string
  accent: string
}

export interface WorkspaceSettings {
  webglMax: number
  notifications: boolean
  fontFamily: string
  fontSize: number
  theme: ThemeSettings
}

/** 저장 포맷 버전 (SPEC 9.2 / 18.4). */
export const WORKSPACE_VERSION = 2

export interface Workspace {
  version: typeof WORKSPACE_VERSION
  viewport: { x: number; y: number; zoom: number }
  nodes: CanvasNode[]
  settings: WorkspaceSettings
}

/** SPEC 6.2 / 6.3 / 9.1 기본값. */
export const DEFAULT_SETTINGS: WorkspaceSettings = {
  webglMax: 4,
  notifications: true,
  fontFamily: '"D2Coding", "Sarasa Mono K", Menlo, monospace',
  fontSize: 13,
  theme: { preset: 'dark', accent: '#4c8dff' }
}

/**
 * 노드 상태 (SPEC 8.1).
 *
 * `background`는 **에이전트가 백그라운드 작업을 기다리는 중**이다. 사람이 할 일은
 * 없으므로 `waiting`(입력 대기)과 반드시 구별해야 한다 — 둘을 섞으면 정작 나를
 * 기다리는 노드를 못 찾는다.
 */
export type SessionState = 'unknown' | 'working' | 'waiting' | 'background' | 'done' | 'detached'

export interface NodeStatus {
  nodeId: NodeId
  state: SessionState
  unseen: boolean
  at: string // 이벤트 시각
}
