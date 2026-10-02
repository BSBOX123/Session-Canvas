/**
 * 노드별 작업 기록 캐시 (SPEC 16 / 19 단계 8).
 *
 * **언제 읽는가**: 포커스가 바뀔 때와 그 노드에 상태 이벤트가 올 때만이다.
 * 폴링하지 않는다 — 증분 읽기라 두 번째부터는 1~2ms지만(R16), 첫 읽기는
 * 20~150ms이고 노드가 여러 개면 쌓인다.
 *
 * 워크스페이스에 넣지 않는다. 저장 대상이 아니다 — transcript와 git에서 언제든
 * 다시 만들 수 있다 (SPEC 9.1의 원칙과 같다).
 */
import { create } from 'zustand'
import type { WorkLogView } from '@shared/ipc'
import type { NodeId, TerminalNodeData } from '@shared/types'
import { useWorkspace } from './workspace'

interface WorkLogState {
  views: Readonly<Record<NodeId, WorkLogView>>
  /** 지금 읽고 있는 노드. 같은 노드를 겹쳐 읽지 않기 위해 둔다. */
  loading: ReadonlySet<NodeId>
  refresh(node: TerminalNodeData): Promise<void>
  forget(id: NodeId): void
}

export const useWorkLog = create<WorkLogState>((set, get) => ({
  views: {},
  loading: new Set<NodeId>(),

  async refresh(node) {
    if (get().loading.has(node.id)) return
    set((state) => {
      const next = new Set(state.loading)
      next.add(node.id)
      return { loading: next }
    })
    try {
      const view = await window.api.workLog.get({
        nodeId: node.id,
        cwd: node.terminal.cwd,
        agentSessionId: node.terminal.agentSessionId,
        transcriptPath: node.terminal.transcriptPath
      })
      if (view === null) return
      set((state) => ({ views: { ...state.views, [node.id]: view } }))

      // 제목 자동 채우기 (SPEC 19 단계 8). **빈 제목일 때만** — 사용자가 직접
      // 쓴 이름을 덮으면 안 된다. 지금은 빈 제목에 폴더명을 보여 주고 있다.
      const current = useWorkspace.getState().nodes.find((n) => n.id === node.id)
      if (view.title !== null && current !== undefined && current.title.trim().length === 0) {
        useWorkspace.getState().updateNode(node.id, { title: view.title })
      }
    } finally {
      set((state) => {
        const next = new Set(state.loading)
        next.delete(node.id)
        return { loading: next }
      })
    }
  },

  forget(id) {
    set((state) => {
      if (!(id in state.views)) return {}
      const views = { ...state.views }
      delete views[id]
      return { views }
    })
  }
}))
