/**
 * 개발 모드 전용 점검 훅 (SPEC 14.3).
 *
 * `scripts/check-*.mjs`가 CDP로 캔버스를 조작하고 xterm 버퍼를 읽는 데 쓴다.
 * `import.meta.env.DEV` 가드 안에서만 import되므로 프로덕션 번들에는 없다.
 */
import type { NodeId, TerminalNodeData } from '@shared/types'
import { useWorkspace, type NewNodeInput } from './state/workspace'
import { debugTerminals, focus } from './terminal/TerminalRegistry'

export function installDevBridge(): void {
  window.__sessionCanvas = {
    get terminals() {
      return debugTerminals()
    },
    get nodes() {
      return useWorkspace.getState().nodes
    },
    addNode: (input: NewNodeInput) => useWorkspace.getState().addNode(input).id,
    updateNode: (id: NodeId, patch: Partial<TerminalNodeData>) =>
      useWorkspace.getState().updateNode(id, patch),
    removeNode: (id: NodeId) => useWorkspace.getState().removeNode(id),
    focus
  }
}
