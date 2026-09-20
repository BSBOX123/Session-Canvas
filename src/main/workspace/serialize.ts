/**
 * workspace.json 직렬화·검증 (SPEC 9.2). 순수 함수 — 단위 테스트 대상.
 */
import {
  DEFAULT_SETTINGS,
  NODE_ID_PATTERN,
  type TerminalNodeData,
  type Workspace
} from '../../shared/types'

export const WORKSPACE_VERSION = 1

export type ParseResult =
  | { status: 'ok'; workspace: Workspace }
  /** 읽을 수는 없지만 덮어써서도 안 되는 상태. */
  | { status: 'unsupported-version'; version: number }
  | { status: 'corrupt'; reason: string }

export function emptyWorkspace(): Workspace {
  return {
    version: WORKSPACE_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** 알 수 없는 필드는 버리고, 모자란 필드는 기본값으로 채운다. */
function normalizeNode(raw: unknown): TerminalNodeData | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id, '')
  // id는 PTY·tmux·훅 파일 경로에 쓰인다. 패턴에 맞지 않으면 버린다 (SPEC 11).
  if (!NODE_ID_PATTERN.test(id)) return null
  const cwd = str(raw.cwd, '')
  if (cwd.length === 0) return null

  const position = isRecord(raw.position) ? raw.position : {}
  const size = isRecord(raw.size) ? raw.size : {}
  const now = new Date().toISOString()

  return {
    id,
    title: str(raw.title, ''),
    description: str(raw.description, ''),
    cwd,
    command: typeof raw.command === 'string' ? raw.command : null,
    tmuxSession: str(raw.tmuxSession, `sc-${id}`),
    claudeSessionId: typeof raw.claudeSessionId === 'string' ? raw.claudeSessionId : null,
    position: { x: num(position.x, 0), y: num(position.y, 0) },
    size: { width: num(size.width, 640), height: num(size.height, 420) },
    color: typeof raw.color === 'string' ? raw.color : null,
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now)
  }
}

export function parseWorkspace(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (error) {
    return { status: 'corrupt', reason: error instanceof Error ? error.message : 'JSON 파싱 실패' }
  }
  if (!isRecord(data)) return { status: 'corrupt', reason: '최상위가 객체가 아닙니다' }

  const version = num(data.version, 0)
  if (version > WORKSPACE_VERSION) return { status: 'unsupported-version', version }
  if (version < 1)
    return { status: 'corrupt', reason: `알 수 없는 version: ${String(data.version)}` }

  const viewport = isRecord(data.viewport) ? data.viewport : {}
  const settings = isRecord(data.settings) ? data.settings : {}
  const nodes = Array.isArray(data.nodes) ? data.nodes : []

  return {
    status: 'ok',
    workspace: {
      version: WORKSPACE_VERSION,
      viewport: {
        x: num(viewport.x, 0),
        y: num(viewport.y, 0),
        zoom: num(viewport.zoom, 1)
      },
      nodes: nodes.map(normalizeNode).filter((node): node is TerminalNodeData => node !== null),
      settings: {
        webglMax: num(settings.webglMax, DEFAULT_SETTINGS.webglMax),
        notifications:
          typeof settings.notifications === 'boolean'
            ? settings.notifications
            : DEFAULT_SETTINGS.notifications,
        fontFamily: str(settings.fontFamily, DEFAULT_SETTINGS.fontFamily),
        fontSize: num(settings.fontSize, DEFAULT_SETTINGS.fontSize)
      }
    }
  }
}

export function serializeWorkspace(workspace: Workspace): string {
  return `${JSON.stringify({ ...workspace, version: WORKSPACE_VERSION }, null, 2)}\n`
}
