/**
 * 훅 상태 ↔ main 연결 (SPEC 8.5 / 8.6).
 *
 *  - `status:changed`를 받아 스토어에 반영
 *  - 워크스페이스의 노드 목록을 main에 알려 준다 (없는 노드의 파일은 무시)
 *  - unseen 개수를 Dock 배지로
 *  - 창이 비활성일 때 `waiting`/`done`으로 **바뀐 순간**만 알림
 */
import type { NodeId } from '@shared/types'
import { applyFontSettings, applyTerminalTheme, setWebglMax } from '../terminal/TerminalRegistry'
import { applyThemeToDocument } from '../theme'
import { useWorkspace } from './workspace'

/**
 * 그 노드가 지금 눈에 보이는가 (SPEC 8.6).
 * 개요 단계에서는 터미널이 없으니 "보인다"고 치지 않는다 — 무슨 일이
 * 일어났는지 알 수 없기 때문이다.
 */
function isNodeVisible(nodeId: NodeId): boolean {
  if (useWorkspace.getState().zoomLevel === 'overview') return false
  const element = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
  if (element === null) return false
  const rect = element.getBoundingClientRect()
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  )
}

export function startStatusBridge(): () => void {
  const store = useWorkspace

  const offStatus = window.api.status.onChange((change) => {
    const before = store.getState().statuses[change.nodeId]
    store.getState().applyStatus(change)
    const after = store.getState().statuses[change.nodeId]
    if (!after || !after.unseen) return
    // 같은 상태가 다시 온 것은 알리지 않는다 — 도구 호출마다 알림이 쏟아진다.
    if (before?.state === after.state && before.unseen) return
    // SPEC 8.6: 창이 비활성이거나, 그 노드가 화면 밖이거나 개요 단계일 때만 알린다.
    if (document.hasFocus() && isNodeVisible(change.nodeId)) return
    const node = store.getState().nodes.find((n) => n.id === change.nodeId)
    if (!node) return
    window.api.app.notify(
      node.id,
      node.title || node.terminal.cwd.split('/').pop() || '터미널',
      after.state
    )
  })

  let lastKnown = ''
  let lastBadge = -1
  let lastNotifications: boolean | null = null
  let lastFont = ''
  let lastTheme = ''
  let lastWebglMax: number | null = null

  const sync = (state: ReturnType<typeof store.getState>): void => {
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

    const theme = `${state.settings.theme.preset}|${state.settings.theme.accent}`
    if (theme !== lastTheme) {
      lastTheme = theme
      applyThemeToDocument(state.settings.theme)
      applyTerminalTheme(state.settings.theme)
    }

    const font = `${state.settings.fontFamily}|${state.settings.fontSize}`
    if (font !== lastFont) {
      lastFont = font
      applyFontSettings(state.settings.fontFamily, state.settings.fontSize)
    }

    if (state.settings.webglMax !== lastWebglMax) {
      lastWebglMax = state.settings.webglMax
      setWebglMax(state.settings.webglMax)
    }

    if (state.settings.notifications !== lastNotifications) {
      lastNotifications = state.settings.notifications
      window.api.app.setNotificationsEnabled(state.settings.notifications)
    }
  }

  // 불러온 워크스페이스의 설정을 **지금 한 번** 반영한다. 구독만 걸어 두면
  // 다음 변경이 올 때까지 기본 테마로 떠 있게 된다.
  sync(store.getState())
  const offStore = store.subscribe(sync)

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
