/**
 * 워크스페이스 상태 (SPEC D8, 9.1).
 *
 * 단계 2에서는 메모리에만 있다. `workspace.json` 영속화는 단계 3.
 */
import { nanoid } from 'nanoid'
import { create } from 'zustand'
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
  addNode(input: NewNodeInput): TerminalNodeData
  updateNode(id: NodeId, patch: Partial<TerminalNodeData>): void
  removeNode(id: NodeId): void
  setViewport(viewport: Workspace['viewport']): void
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

  addNode(input) {
    const id = newNodeId()
    const now = new Date().toISOString()
    const node: TerminalNodeData = {
      id,
      title: input.title,
      description: '',
      cwd: input.cwd,
      command: input.command,
      tmuxSession: `sc-${id}`,
      claudeSessionId: null,
      position: placeWithoutOverlap(get().nodes, input.position),
      size: { ...DEFAULT_NODE_SIZE },
      color: null,
      createdAt: now,
      updatedAt: now
    }
    set((state) => ({ nodes: [...state.nodes, node] }))
    return node
  },

  updateNode(id, patch) {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...patch, updatedAt: new Date().toISOString() } : node
      )
    }))
  },

  removeNode(id) {
    set((state) => ({ nodes: state.nodes.filter((node) => node.id !== id) }))
  },

  setViewport(viewport) {
    set({ viewport })
  }
}))
