/**
 * 키보드 단축키 (SPEC 7.5).
 *
 * **원칙: 포커스된 터미널에는 모든 키를 그대로 넘긴다.** 앱 단축키는 `Cmd`
 * 조합만 쓰고, `Esc`·`Shift+Tab`·`Ctrl+*`·`Option+*`은 절대 가로채지 않는다
 * (Claude Code가 쓴다).
 */
import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { NodeId, TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { dispose, focus, focusedNode, get, changeFontSize } from '../terminal/TerminalRegistry'
import { boundsOf, viewportDuration, zoomToFit, ZOOM_TO_NODE } from '../canvas/zoomLevel'

export interface ShortcutActions {
  openNewNodeDialog(): void
}

/** 주의가 필요한 순서: 입력 대기 → 완료 (SPEC 7.5의 `Cmd+J`). */
function attentionOrder(
  nodes: TerminalNodeData[],
  statuses: Readonly<Record<NodeId, { state: string; unseen: boolean }>>
): TerminalNodeData[] {
  const rank = (id: NodeId): number => {
    const status = statuses[id]
    if (!status) return 99
    if (status.state === 'waiting') return 0
    if (status.state === 'done') return 1
    return 99
  }
  return nodes.filter((node) => rank(node.id) < 99).sort((a, b) => rank(a.id) - rank(b.id))
}

export function useShortcuts({ openNewNodeDialog }: ShortcutActions): void {
  const { setCenter, getViewport, setViewport } = useReactFlow()

  useEffect(() => {
    /** 직전 뷰 — `Cmd+Enter` 토글용 (SPEC 7.5). */
    let previousViewport: { x: number; y: number; zoom: number } | null = null

    const store = useWorkspace
    /** 화면 크기. 배율을 직접 계산하려면 필요하다. */
    const paneSize = (): { width: number; height: number } =>
      document.querySelector('.react-flow')?.getBoundingClientRect() ?? { width: 0, height: 0 }

    /** 어떤 영역이 통째로 보이도록 이동한다. */
    const showBounds = async (
      bounds: { x: number; y: number; width: number; height: number },
      maxZoom = 1
    ): Promise<void> => {
      const pane = paneSize()
      const zoom = zoomToFit(bounds, pane, { ...ZOOM_TO_NODE, maxZoom })
      console.log(
        '[디버그] showBounds',
        JSON.stringify({ bounds, pane: { w: pane.width, h: pane.height }, zoom })
      )
      const ok = await setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
        zoom,
        duration: viewportDuration()
      })
      console.log('[디버그] setCenter 반환', ok)
    }

    // 노드 전체가 화면에 들어오도록 맞춘다. 배율 고정은 큰 노드를 자른다.
    const centerOn = async (node: TerminalNodeData): Promise<void> => {
      await showBounds({ ...node.position, ...node.size })
      focus(node.id)
      store.getState().markSeen(node.id)
    }

    const current = (): TerminalNodeData | null => {
      const id = focusedNode()
      if (id === null) return null
      return store.getState().nodes.find((node) => node.id === id) ?? null
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Cmd 조합이 아니면 손대지 않는다. Ctrl·Option 조합도 그대로 넘긴다.
      if (!event.metaKey || event.ctrlKey || event.altKey) return

      const nodes = store.getState().nodes
      const key = event.key
      const take = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (key.toLowerCase() === 'n') {
        take()
        openNewNodeDialog()
        return
      }

      if (key === '0') {
        take()
        // 전체 보기. 노드가 없으면 할 일이 없다.
        const bounds = boundsOf(nodes)
        if (bounds !== null) void showBounds(bounds, 1)
        return
      }

      if (/^[1-9]$/.test(key)) {
        // 생성 순서 n번째 노드 (SPEC 7.5).
        const node = nodes[Number(key) - 1]
        if (!node) return
        take()
        void centerOn(node)
        return
      }

      if (key.toLowerCase() === 'j') {
        take()
        const queue = attentionOrder(nodes, store.getState().statuses)
        const focused = focusedNode()
        const next = queue.find((node) => node.id !== focused) ?? queue[0]
        if (next) void centerOn(next)
        return
      }

      if (key === 'Enter') {
        take()
        if (previousViewport !== null) {
          const target = previousViewport
          previousViewport = null
          void setViewport(target, { duration: viewportDuration() })
          return
        }
        const node = current()
        if (!node) return
        previousViewport = getViewport()
        void centerOn(node)
        return
      }

      if (key.toLowerCase() === 'w') {
        // 닫기(분리) — tmux 세션은 살아 있다 (SPEC 5.3/7.5).
        const node = current()
        if (!node) return
        take()
        dispose(node.id, 'detach')
        store.getState().removeNode(node.id)
        return
      }

      if (key.toLowerCase() === 'c') {
        const entry = current() ? get(current()!.id) : undefined
        const selection = entry?.terminal.getSelection() ?? ''
        // 선택이 없으면 가로채지 않는다 — Ctrl+C는 터미널 몫이고, Cmd+C는
        // 다른 곳(예: 입력란)에서 기본 동작이 있어야 한다.
        if (selection.length === 0) return
        take()
        window.api.clipboard.write(selection)
        return
      }

      if (key.toLowerCase() === 'v') {
        const node = current()
        if (!node) return
        take()
        void window.api.clipboard.read().then((text) => {
          if (text.length > 0) window.api.pty.write(node.id, text)
        })
        return
      }

      if (key === '=' || key === '+' || key === '-') {
        const node = current()
        if (!node) return
        take()
        changeFontSize(node.id, key === '-' ? -1 : 1)
      }
    }

    // 캡처 단계에서 본다. xterm의 textarea가 먼저 삼키면 Cmd 조합이 오지 않는다.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [getViewport, openNewNodeDialog, setCenter, setViewport])
}
