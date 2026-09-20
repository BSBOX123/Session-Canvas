/**
 * 워크스페이스 상태 (SPEC D8, 9.1).
 *
 * 영속 대상은 `Workspace` 부분뿐이다. 세션 존재 여부·분리된 세션 목록은
 * tmux에서 매번 재구성한다 (SPEC 9.1) — 저장하지 않는다.
 */
import { nanoid } from 'nanoid'
import { create } from 'zustand'
import type { OrphanSession } from '@shared/ipc'
import { DEFAULT_SETTINGS, type NodeId, type TerminalNodeData, type Workspace } from '@shared/types'

/** SPEC 7.1: 최소 크기. */
export const MIN_NODE_SIZE = { width: 360, height: 220 }
const DEFAULT_NODE_SIZE = { width: 640, height: 420 }

export interface NewNodeInput {
  cwd: string
  title: string
  command: string | null
  position: { x: number; y: number }
}

interface WorkspaceState extends Omit<Workspace, 'version'> {
  /** 첫 로드가 끝나기 전에는 저장하지 않는다 — 빈 상태로 덮어쓰면 안 된다. */
  hydrated: boolean
  /** tmux 세션이 없는 노드 (SPEC 5.4 "세션 없음"). */
  missingSessions: ReadonlySet<NodeId>
  /** 워크스페이스에 없는 tmux 세션 (SPEC 5.4 "분리된 세션"). */
  orphans: OrphanSession[]
  /** 로드 실패·복구 안내 (SPEC 9.2). */
  notice: string | null

  hydrate(workspace: Workspace, notice: string | null): void
  addNode(input: NewNodeInput): TerminalNodeData
  /** 분리된 세션을 원래 id 그대로 노드로 되살린다 (SPEC 5.4). */
  restoreNode(session: OrphanSession, position: { x: number; y: number }): TerminalNodeData
  updateNode(id: NodeId, patch: Partial<TerminalNodeData>): void
  removeNode(id: NodeId): void
  setViewport(viewport: Workspace['viewport']): void
  setMissingSessions(ids: NodeId[]): void
  markSessionStarted(id: NodeId): void
  setOrphans(orphans: OrphanSession[]): void
  dismissNotice(): void
}

function makeNode(
  id: NodeId,
  input: Omit<NewNodeInput, 'position'>,
  position: { x: number; y: number }
): TerminalNodeData {
  const now = new Date().toISOString()
  return {
    id,
    title: input.title,
    description: '',
    cwd: input.cwd,
    command: input.command,
    tmuxSession: `sc-${id}`,
    claudeSessionId: null,
    position,
    size: { ...DEFAULT_NODE_SIZE },
    color: null,
    createdAt: now,
    updatedAt: now
  }
}

/** nanoid 기본 알파벳은 `[A-Za-z0-9_-]`라 `NODE_ID_PATTERN`을 그대로 만족한다. */
function newNodeId(): NodeId {
  return nanoid(10)
}

/**
 * SPEC 7.2: 기존 노드와 겹치면 오른쪽으로 밀어 배치한다.
 */
function placeWithoutOverlap(
  nodes: TerminalNodeData[],
  position: { x: number; y: number }
): { x: number; y: number } {
  const GAP = 24
  const { y } = position
  let { x } = position
  let moved = true
  let guard = 0
  while (moved && guard < 50) {
    moved = false
    guard += 1
    for (const node of nodes) {
      const overlapX =
        x < node.position.x + node.size.width && node.position.x < x + DEFAULT_NODE_SIZE.width
      const overlapY =
        y < node.position.y + node.size.height && node.position.y < y + DEFAULT_NODE_SIZE.height
      if (overlapX && overlapY) {
        x = node.position.x + node.size.width + GAP
        moved = true
      }
    }
  }
  return { x, y }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  settings: { ...DEFAULT_SETTINGS },

  hydrated: false,
  missingSessions: new Set<NodeId>(),
  orphans: [],
  notice: null,

  hydrate(workspace, notice) {
    set({
      nodes: workspace.nodes,
      viewport: workspace.viewport,
      settings: workspace.settings,
      notice,
      hydrated: true
    })
  },

  addNode(input) {
    const node = makeNode(newNodeId(), input, placeWithoutOverlap(get().nodes, input.position))
    set((state) => ({ nodes: [...state.nodes, node] }))
    return node
  },

  restoreNode(session, position) {
    const node = makeNode(
      session.id,
      // 명령은 이미 그 세션 안에서 돌고 있다. 다시 실행하면 안 된다 — `-A`로
      // 붙기만 하므로 여기 값은 쓰이지 않지만, 의미상 null이 맞다.
      { cwd: session.cwd, title: '', command: null },
      placeWithoutOverlap(get().nodes, position)
    )
    set((state) => ({
      nodes: [...state.nodes, node],
      orphans: state.orphans.filter((o) => o.id !== session.id)
    }))
    return node
  },

  setMissingSessions(ids) {
    set({ missingSessions: new Set(ids) })
  },

  markSessionStarted(id) {
    set((state) => {
      const next = new Set(state.missingSessions)
      next.delete(id)
      return { missingSessions: next }
    })
  },

  setOrphans(orphans) {
    set({ orphans })
  },

  dismissNotice() {
    set({ notice: null })
  },

  updateNode(id, patch) {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...patch, updatedAt: new Date().toISOString() } : node
      )
    }))
  },

  removeNode(id) {
    set((state) => {
      const missing = new Set(state.missingSessions)
      missing.delete(id)
      return { nodes: state.nodes.filter((node) => node.id !== id), missingSessions: missing }
    })
  },

  setViewport(viewport) {
    set({ viewport })
  }
}))

/**
 * 변경될 때마다 main으로 보낸다. 실제 쓰기는 main에서 500ms 디바운스 후
 * 원자적으로 한다 (SPEC 9.2).
 */
export function startPersistence(): () => void {
  let previous = selectPersisted(useWorkspace.getState())
  return useWorkspace.subscribe((state) => {
    if (!state.hydrated) return
    const next = selectPersisted(state)
    if (next === previous) return
    previous = next
    window.api.workspace.save(JSON.parse(next) as Workspace)
  })
}

/** 저장 대상만 골라 문자열로. 얕은 비교로는 매 렌더 저장이 튄다. */
function selectPersisted(state: WorkspaceState): string {
  return JSON.stringify({
    version: 1,
    viewport: state.viewport,
    nodes: state.nodes,
    settings: state.settings
  })
}
