import { useCallback, useEffect, useState } from 'react'
import type { HookInstallState } from '@shared/ipc'
import { useWorkspace } from '../state/workspace'

const STATE_LABEL: Record<HookInstallState, string> = {
  installed: '켜짐',
  'not-installed': '꺼짐',
  outdated: '업데이트 필요'
}

/**
 * 설정 화면 (SPEC 8.4 / 8.6).
 *
 * ⚠️ [상태 감지 켜기]는 `~/.claude/settings.json`을 고치는 **유일한 통로**다.
 * 반드시 동의 화면을 거치고, 무엇을 하는지 먼저 보여준다 (SPEC 0.4).
 */
function SettingsPanel({ onClose }: { onClose(): void }): React.JSX.Element {
  const settings = useWorkspace((s) => s.settings)
  const setSettings = useWorkspace((s) => s.setSettings)
  const [hookState, setHookState] = useState<HookInstallState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setHookState(await window.api.hooks.state())
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.hooks.state().then((state) => {
      if (!cancelled) setHookState(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const install = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const { backup } = await window.api.hooks.install()
      setResult(
        backup === null
          ? '훅을 설치했습니다. (기존 설정 파일이 없어 백업은 만들지 않았습니다)'
          : `훅을 설치했습니다. 원본은 ${backup} 로 백업했습니다.`
      )
    } catch (error) {
      setResult(`설치하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      setConfirming(false)
      await refresh()
    }
  }

  const uninstall = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const { backup } = await window.api.hooks.uninstall()
      setResult(
        backup === null
          ? '훅을 제거했습니다.'
          : `훅을 제거했습니다. 원본은 ${backup} 로 백업했습니다.`
      )
    } catch (error) {
      setResult(`제거하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog settings"
        role="dialog"
        aria-label="설정"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <h2>설정</h2>

        <section>
          <h3>
            상태 감지{' '}
            <span className="settings-state">{hookState ? STATE_LABEL[hookState] : '…'}</span>
          </h3>
          <p>
            Claude Code가 작업 중인지, 입력을 기다리는지, 끝났는지를 노드에 표시합니다. 이를 위해
            Claude Code의 훅을 사용자 설정에 추가합니다.
          </p>

          {confirming ? (
            <div className="settings-consent">
              <p>
                <code>~/.claude/settings.json</code> 에 훅을 추가합니다.
                <br />
                원본은 <code>settings.json.bak-날짜</code> 로 백업합니다.
                <br />
                기존 훅과 다른 설정은 그대로 둡니다. 앱 밖에서 실행한 Claude Code에는 영향이
                없습니다.
              </p>
              <div className="dialog-actions">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
                  취소
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void install()}
                  disabled={busy}
                >
                  {busy ? '설치 중…' : '추가하고 켜기'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dialog-actions start">
              {hookState === 'installed' ? (
                <button type="button" onClick={() => void uninstall()} disabled={busy}>
                  상태 감지 끄기
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => setConfirming(true)}>
                  {hookState === 'outdated' ? '상태 감지 업데이트' : '상태 감지 켜기'}
                </button>
              )}
            </div>
          )}

          {result !== null && <p className="settings-result">{result}</p>}
        </section>

        <section>
          <h3>알림</h3>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(e) => setSettings({ notifications: e.target.checked })}
            />
            입력 대기·완료를 macOS 알림으로 알려주기
          </label>
        </section>

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
