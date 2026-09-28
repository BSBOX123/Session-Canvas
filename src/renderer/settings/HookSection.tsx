import { useCallback, useEffect, useState } from 'react'
import type { HookInstallState } from '@shared/ipc'
import type { AgentKind } from '@shared/types'

const STATE_LABEL: Record<HookInstallState, string> = {
  installed: '켜짐',
  'not-installed': '꺼짐',
  outdated: '업데이트 필요'
}

interface AgentCopy {
  name: string
  settingsPath: string
  backupName: string
}

const COPY: Record<AgentKind, AgentCopy> = {
  claude: {
    name: 'Claude Code',
    settingsPath: '~/.claude/settings.json',
    backupName: 'settings.json.bak-날짜'
  },
  codex: {
    name: 'Codex',
    settingsPath: '~/.codex/hooks.json',
    backupName: 'hooks.json.bak-날짜'
  }
}

/**
 * 에이전트 하나의 상태 감지 설치 (SPEC 8.4 / 21.2).
 *
 * ⚠️ [상태 감지 켜기]는 그 에이전트의 **사용자 전역 설정**을 고치는 유일한
 * 통로다. 반드시 동의 화면을 거치고, 무엇을 하는지 먼저 보여준다 (SPEC 0.4).
 *
 * Codex는 파일을 고쳐도 끝이 아니다 — 사용자가 Codex에서 `/hooks`로 승인해야
 * 훅이 실행된다. 그 안내를 설치 직후에 크게 띄운다. 빠뜨리면 배지가 영영
 * 안 뜨는데 원인을 알 길이 없다 (SPEC 21.2).
 */
function HookSection({ agent }: { agent: AgentKind }): React.JSX.Element {
  const copy = COPY[agent]
  const [state, setState] = useState<HookInstallState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [approval, setApproval] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setState(await window.api.hooks.state(agent))
  }, [agent])

  useEffect(() => {
    let cancelled = false
    void window.api.hooks.state(agent).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  const install = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const { backup, needsApproval } = await window.api.hooks.install(agent)
      setApproval(needsApproval)
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
    setApproval(false)
    try {
      const { backup } = await window.api.hooks.uninstall(agent)
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
    <section>
      <h3>
        상태 감지 — {copy.name}{' '}
        <span className="settings-state">{state ? STATE_LABEL[state] : '…'}</span>
      </h3>
      <p>
        {copy.name}가 작업 중인지, 입력을 기다리는지, 끝났는지를 노드에 표시합니다. 이를 위해{' '}
        {copy.name}의 훅을 사용자 설정에 추가합니다.
      </p>

      {confirming ? (
        <div className="settings-consent">
          <p>
            <code>{copy.settingsPath}</code> 에 훅을 추가합니다.
            <br />
            원본은 <code>{copy.backupName}</code> 로 백업합니다.
            <br />
            기존 훅과 다른 설정은 그대로 둡니다. 앱 밖에서 실행한 {copy.name}에는 영향이 없습니다.
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
          {state === 'installed' ? (
            <button type="button" onClick={() => void uninstall()} disabled={busy}>
              상태 감지 끄기
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => setConfirming(true)}>
              {state === 'outdated' ? '상태 감지 업데이트' : '상태 감지 켜기'}
            </button>
          )}
        </div>
      )}

      {result !== null && <p className="settings-result">{result}</p>}

      {approval && (
        <div className="settings-approval">
          <p>
            <strong>한 단계가 더 남았습니다.</strong> Codex는 훅을 직접 승인해야 실행합니다. Codex를
            열고 <code>/hooks</code> 를 실행해 이 훅을 신뢰로 표시하세요.
          </p>
          <p>
            승인하지 않으면 파일은 들어갔지만 <strong>상태 배지가 뜨지 않습니다.</strong> 승인은 훅
            내용에 묶이므로, 나중에 앱이 훅을 바꾸면 다시 승인해야 합니다.
          </p>
        </div>
      )}
    </section>
  )
}

export default HookSection
