import { useCallback, useEffect, useState } from 'react'
import type { HookInstallState } from '@shared/ipc'
import { ACCENT_CHOICES, THEME_PRESETS } from '../theme'
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
          <p className="settings-hint">
            창이 비활성이거나, 그 노드가 화면 밖 또는 개요 단계일 때만 알립니다.
          </p>
        </section>

        <section>
          <h3>테마</h3>
          <div className="theme-presets">
            {Object.entries(THEME_PRESETS).map(([key, palette]) => (
              <button
                key={key}
                type="button"
                className={`theme-preset${settings.theme.preset === key ? ' selected' : ''}`}
                onClick={() => setSettings({ theme: { ...settings.theme, preset: key } })}
                title={palette.name}
              >
                <span className="theme-swatches">
                  <span style={{ background: palette.bg }} />
                  <span style={{ background: palette.panel2 }} />
                  <span style={{ background: palette.fg }} />
                </span>
                {palette.name}
              </button>
            ))}
          </div>

          <label>강조색</label>
          <div className="accent-choices">
            {ACCENT_CHOICES.map((accent) => (
              <button
                key={accent}
                type="button"
                className={`accent-choice${settings.theme.accent === accent ? ' selected' : ''}`}
                style={{ background: accent }}
                onClick={() => setSettings({ theme: { ...settings.theme, accent } })}
                title={accent}
              />
            ))}
          </div>
          <p className="settings-hint">
            상태 테두리 색(흰색·파랑·주황·초록)은 테마와 무관하게 유지됩니다 — 상태를 색으로
            알아보는 게 먼저라서입니다.
          </p>
        </section>

        <section>
          <h3>터미널</h3>

          <label htmlFor="settings-font-family">폰트</label>
          <input
            id="settings-font-family"
            value={settings.fontFamily}
            onChange={(e) => setSettings({ fontFamily: e.target.value })}
          />
          <p className="settings-hint">
            설치되지 않은 폰트는 뒤의 것으로 넘어갑니다. 기본값은 D2Coding → Menlo 순입니다.
          </p>

          <label htmlFor="settings-font-size">글자 크기 ({settings.fontSize}px)</label>
          <input
            id="settings-font-size"
            type="range"
            min={8}
            max={24}
            value={settings.fontSize}
            onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
          />

          <label htmlFor="settings-webgl-max">WebGL 터미널 수 ({settings.webglMax}개)</label>
          <input
            id="settings-webgl-max"
            type="range"
            min={0}
            max={8}
            value={settings.webglMax}
            onChange={(e) => setSettings({ webglMax: Number(e.target.value) })}
          />
          <p className="settings-hint">
            최근 포커스한 이 개수만큼만 WebGL로 그립니다. 브라우저가 동시에 열 수 있는 WebGL
            컨텍스트가 제한돼 있어, 높이면 오래된 것부터 끊길 수 있습니다.
          </p>
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
