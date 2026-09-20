/**
 * macOS 알림과 Dock 배지 (SPEC 8.6).
 */
import { app, BrowserWindow, Notification } from 'electron'
import type { NodeId, SessionState } from '../../shared/types'

export interface NotifyRequest {
  nodeId: NodeId
  title: string
  state: SessionState
}

export class Notifier {
  private enabled = true

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onClick: (nodeId: NodeId) => void
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * 창이 비활성일 때만 띄운다. 화면 밖/개요 단계인지는 renderer만 알 수
   * 있어서, 그 판단은 renderer가 하고 여기서는 창 활성 여부만 본다.
   */
  notify({ nodeId, title, state }: NotifyRequest): void {
    if (!this.enabled) return
    if (!Notification.isSupported()) return

    const body = state === 'waiting' ? '입력을 기다리고 있어요' : '작업이 끝났어요'
    const notification = new Notification({ title: title || '터미널', body, silent: false })
    notification.on('click', () => {
      const win = this.getWindow()
      if (win !== null && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      app.focus({ steal: true })
      this.onClick(nodeId)
    })
    notification.show()
  }

  /** unseen인 `waiting` + `done` 노드 수 (SPEC 8.6). */
  setBadge(count: number): void {
    app.setBadgeCount(count > 0 ? count : 0)
  }
}
