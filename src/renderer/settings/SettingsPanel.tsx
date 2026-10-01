import { ACCENT_CHOICES, THEME_PRESETS } from '../theme'
import HookSection from './HookSection'
import { useWorkspace } from '../state/workspace'

/**
 * 설정 화면 (SPEC 8.4 / 8.6 / 21.2).
 *
 * 상태 감지는 에이전트마다 따로 켠다 — 설정 파일도 이벤트 목록도 다르다.
 * 사용자 전역 설정을 고치는 통로는 `HookSection` 하나뿐이다 (SPEC 0.4).
 */
function SettingsPanel({ onClose }: { onClose(): void }): React.JSX.Element {
  const settings = useWorkspace((s) => s.settings)
  const setSettings = useWorkspace((s) => s.setSettings)
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

        <HookSection agent="claude" />
        <HookSection agent="codex" />

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
