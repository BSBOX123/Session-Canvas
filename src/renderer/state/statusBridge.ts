/**
 * 훅 상태 ↔ main 연결 (SPEC 8.5 / 8.6).
 *
 *  - `status:changed`를 받아 스토어에 반영
 *  - 워크스페이스의 노드 목록을 main에 알려 준다 (없는 노드의 파일은 무시)
 *  - unseen 개수를 Dock 배지로
 *  - 창이 비활성일 때 `waiting`/`done`으로 **바뀐 순간**만 알림
 */
import type { NodeId } from '@shared/types'
import { useWorkspace } from './workspace'

export function startStatusBridge(): () => void {
  const store = useWorkspace

  const offStatus = window.api.status.onChange((change) => {
    const before = store.getState().statuses[change.nodeId]
    store.getState().applyStatus(change)
    const after = store.getState().statuses[change.nodeId]
    if (!after || !after.unseen) return
    // 같은 상태가 다시 온 것은 알리지 않는다 — 도구 호출마다 알림이 쏟아진다.
    if (before?.state === after.state && before.unseen) return
    // 창을 보고 있으면 알리지 않는다. 화면 밖·개요 단계 판단은 단계 5에서 더한다.
    if (document.hasFocus()) return
    const node = store.getState().nodes.find((n) => n.id === change.nodeId)
    if (!node) return
    window.api.app.notify(node.id, node.title || node.cwd.split('/').pop() || '터미널', after.state)
  })

  let lastKnown = ''
  let lastBadge = -1
  let lastNotifications: boolean | null = null

  const offStore = store.subscribe((state) => {
    const ids = state.nodes.map((node) => node.id)
    const known = ids.join(',')
    if (known !== lastKnown) {
      lastKnown = known
      window.api.status.setKnownNodes(ids)
    }

    const badge = Object.values(state.statuses).filter((status) => status.unseen).length
    if (badge !== lastBadge) {
      lastBadge = badge
      window.api.app.setBadge(badge)
    }

    if (state.settings.notifications !== lastNotifications) {
      lastNotifications = state.settings.notifications
      window.api.app.setNotificationsEnabled(state.settings.notifications)
    }
  })

  const offClick = window.api.app.onNotificationClick((nodeId: NodeId) => {
    store.getState().markSeen(nodeId)
    window.dispatchEvent(new CustomEvent('session-canvas:focus-node', { detail: nodeId }))
  })

  return () => {
    offStatus()
    offStore()
    offClick()
  }
}
