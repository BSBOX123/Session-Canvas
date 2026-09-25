/// <reference types="vite/client" />

import type { Terminal } from '@xterm/xterm'
import type { StatusChange } from '@shared/ipc'
import type {
  NodeId,
  NodeStatus,
  TerminalNodeData,
  TerminalPayload,
  Workspace
} from '@shared/types'
import type { NewNodeInput } from './state/workspace'

declare global {
  interface Window {
    /** 개발 모드 전용 점검 훅 (SPEC 14.3). 프로덕션 빌드에는 없다. */
    __sessionCanvas?: {
      readonly terminals: Record<NodeId, Terminal>
      readonly nodes: TerminalNodeData[]
      readonly statuses: Readonly<Record<NodeId, NodeStatus>>
      readonly zoomLevel: 'detail' | 'preview' | 'overview'
      readonly webglNodes: NodeId[]
      readonly focusedNode: NodeId | null
      addNode(input: NewNodeInput): NodeId
      updateNode(id: NodeId, patch: Partial<TerminalNodeData>): void
      updateTerminal(id: NodeId, patch: Partial<TerminalPayload>): void
      removeNode(id: NodeId): void
      markSeen(id: NodeId): void
      applyStatus(change: StatusChange): void
      setSettings(patch: Partial<Workspace['settings']>): void
      setMissingSessions(ids: NodeId[]): void
      focus(id: NodeId): void
      zoomTo(zoom: number): Promise<void>
    }
  }
}

export {}
