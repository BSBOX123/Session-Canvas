/**
 * 개발 모드 전용 점검 훅 (SPEC 14.3).
 *
 * `scripts/check-*.mjs`가 CDP로 캔버스를 조작하고 xterm 버퍼를 읽는 데 쓴다.
 * `import.meta.env.DEV` 가드 안에서만 import되므로 프로덕션 번들에는 없다.
 */
import type { StatusChange } from '@shared/ipc'
import type { NodeId, TerminalNodeData, TerminalPayload, Workspace } from '@shared/types'
import { useWorkspace, type NewNodeInput } from './state/workspace'
import { debugTerminals, focus, focusedNode, webglNodes } from './terminal/TerminalRegistry'

/** 캔버스만 줄 수 있는 것들. `Canvas`가 마운트될 때 채운다. */
interface CanvasDevHelpers {
  zoomTo(zoom: number): Promise<void>
}

let canvasHelpers: CanvasDevHelpers | null = null

export function registerCanvasDevHelpers(helpers: CanvasDevHelpers): void {
  canvasHelpers = helpers
}

export function installDevBridge(): void {
  window.__sessionCanvas = {
    get terminals() {
      return debugTerminals()
    },
    get nodes() {
      return useWorkspace.getState().nodes
    },
    get statuses() {
      return useWorkspace.getState().statuses
    },
    markSeen: (id: NodeId) => useWorkspace.getState().markSeen(id),
    applyStatus: (change: StatusChange) => useWorkspace.getState().applyStatus(change),
    setSettings: (patch: Partial<Workspace['settings']>) =>
      useWorkspace.getState().setSettings(patch),
    setMissingSessions: (ids: NodeId[]) => useWorkspace.getState().setMissingSessions(ids),
    get zoomLevel() {
      return useWorkspace.getState().zoomLevel
    },
    get webglNodes() {
      return webglNodes()
    },
    get focusedNode() {
      return focusedNode()
    },
    addNode: (input: NewNodeInput) => useWorkspace.getState().addNode(input).id,
    updateNode: (id: NodeId, patch: Partial<TerminalNodeData>) =>
      useWorkspace.getState().updateNode(id, patch),
    updateTerminal: (id: NodeId, patch: Partial<TerminalPayload>) =>
      useWorkspace.getState().updateTerminal(id, patch),
    removeNode: (id: NodeId) => useWorkspace.getState().removeNode(id),
    focus,
    // 휠 한 칸이 미리보기 구간(0.4~0.75)을 건너뛰어서, 점검이 배율을
    // 정확히 지정할 수 있어야 한다.
    zoomTo: (zoom: number) => canvasHelpers?.zoomTo(zoom) ?? Promise.resolve()
  }
}
