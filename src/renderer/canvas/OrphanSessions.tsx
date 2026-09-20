import { useReactFlow } from '@xyflow/react'
import { useWorkspace } from '../state/workspace'
import { focus } from '../terminal/TerminalRegistry'

/**
 * 워크스페이스에는 없는데 tmux에는 살아 있는 세션들 (SPEC 5.4).
 * 클릭하면 원래 id 그대로 노드로 복원한다.
 */
function OrphanSessions(): React.JSX.Element | null {
  const orphans = useWorkspace((s) => s.orphans)
  const restoreNode = useWorkspace((s) => s.restoreNode)
  const { screenToFlowPosition } = useReactFlow()

  if (orphans.length === 0) return null

  return (
    <div className="orphan-panel">
      <p className="orphan-title">분리된 세션 {orphans.length}개</p>
      <ul>
        {orphans.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => {
                const position = screenToFlowPosition({
                  x: window.innerWidth / 2,
                  y: window.innerHeight / 2
                })
                const node = restoreNode(session, position)
                window.setTimeout(() => focus(node.id), 150)
              }}
              title={session.cwd}
            >
              <span className="orphan-name">sc-{session.id}</span>
              <span className="orphan-cwd">{session.cwd.split('/').filter(Boolean).pop()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default OrphanSessions
