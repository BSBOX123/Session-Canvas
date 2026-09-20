import { useEffect, useState } from 'react'
import Canvas from './canvas/Canvas'
import { startPersistence, useWorkspace } from './state/workspace'

type BootState =
  { phase: 'loading' } | { phase: 'no-tmux'; version: string | null } | { phase: 'ready' }

/**
 * 시작 흐름 (SPEC 4.3 / 5.4 / 9.2):
 *   tmux 확인 → workspace.json 로드 → 노드별 세션 존재 확인 → 분리된 세션 목록
 */
function App(): React.JSX.Element {
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' })
  const hydrate = useWorkspace((s) => s.hydrate)
  const setMissingSessions = useWorkspace((s) => s.setMissingSessions)
  const setOrphans = useWorkspace((s) => s.setOrphans)

  useEffect(() => {
    let cancelled = false
    let stopPersistence: (() => void) | null = null

    const run = async (): Promise<void> => {
      // tmux가 없거나 낮으면 안내 화면을 띄운다. 앱이 죽으면 안 된다 (SPEC 4.3).
      const tmux = await window.api.tmux.check()
      if (cancelled) return
      if (!tmux.ok) {
        setBoot({ phase: 'no-tmux', version: tmux.version })
        return
      }

      const loaded = await window.api.workspace.load()
      if (cancelled) return
      hydrate(loaded.workspace, loaded.message)
      stopPersistence = startPersistence()

      // SPEC 5.4 복구 흐름
      const ids = loaded.workspace.nodes.map((node) => node.id)
      const existence = await Promise.all(ids.map((id) => window.api.tmux.exists(id)))
      if (cancelled) return
      setMissingSessions(ids.filter((_, index) => !existence[index]))
      setOrphans(await window.api.tmux.listOrphans(ids))
      if (cancelled) return
      setBoot({ phase: 'ready' })
    }

    void run()
    return () => {
      cancelled = true
      stopPersistence?.()
    }
  }, [hydrate, setMissingSessions, setOrphans])

  if (boot.phase === 'loading') {
    return <div className="app boot">불러오는 중…</div>
  }

  if (boot.phase === 'no-tmux') {
    return (
      <div className="app boot">
        <div className="boot-panel">
          <h1>tmux가 필요합니다</h1>
          <p>
            Session Canvas는 앱을 껐다 켜도 세션이 살아 있도록 tmux 3.3 이상을 씁니다.
            {boot.version === null ? ' 설치를 찾지 못했습니다.' : ` 찾은 버전: ${boot.version}`}
          </p>
          <pre>brew install tmux</pre>
          <p className="boot-hint">설치한 뒤 앱을 다시 시작해 주세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Canvas />
    </div>
  )
}

export default App
