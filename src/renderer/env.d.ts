/// <reference types="vite/client" />

import type { Terminal } from '@xterm/xterm'
import type { NodeId, NodeStatus, TerminalNodeData, Workspace } from '@shared/types'
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
      removeNode(id: NodeId): void
      markSeen(id: NodeId): void
      setSettings(patch: Partial<Workspace['settings']>): void
      setMissingSessions(ids: NodeId[]): void
      focus(id: NodeId): void
      zoomTo(zoom: number): Promise<void>
    }
  }
}

export {}
