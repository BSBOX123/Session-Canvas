/** SPEC 9.1 데이터 모델. */

/** nanoid(10) 형식. `[A-Za-z0-9_-]`만 허용한다 (경로 조작 방지, SPEC 8.3/11). */
export type NodeId = string

export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** SPEC 11: IPC로 넘어온 명령 문자열 길이 제한. */
export const MAX_COMMAND_LENGTH = 512

export interface TerminalNodeData {
  id: NodeId
  title: string // 빈 문자열 허용 → UI에서 폴더명 표시
  description: string
  cwd: string // 절대경로
  command: string | null // 기본 "claude", null이면 셸만
  tmuxSession: string // `sc-${id}`
  claudeSessionId: string | null
  position: { x: number; y: number }
  size: { width: number; height: number }
  color: string | null
  createdAt: string // ISO 8601
  updatedAt: string
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

export interface Workspace {
  version: 1
  viewport: { x: number; y: number; zoom: number }
  nodes: TerminalNodeData[]
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

export type SessionState = 'unknown' | 'working' | 'waiting' | 'done' | 'detached'

export interface NodeStatus {
  nodeId: NodeId
  state: SessionState
  unseen: boolean
  at: string // 이벤트 시각
}
