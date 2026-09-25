import type { TerminalNodeData } from '@shared/types'

interface DetachedSessionProps {
  node: TerminalNodeData
  onStart(): void
  /** 이전 Claude Code 대화를 이어서 시작한다 (SPEC 5.4). */
  onResume(): void
}

/**
 * 워크스페이스에는 있는데 tmux 세션이 없는 노드 (SPEC 5.4).
 * 재부팅 등으로 tmux 서버가 사라졌을 때다.
 *
 * [이전 대화 이어서]는 `claudeSessionId`가 있을 때만 보여 준다. 그 값은
 * `SessionStart` 훅이 채우므로(SPEC 8.2), 상태 감지를 켜 두지 않았거나 그
 * 노드에서 Claude Code를 쓴 적이 없으면 [새로 시작]만 나온다.
 */
function DetachedSession({ node, onStart, onResume }: DetachedSessionProps): React.JSX.Element {
  return (
    <div className="detached-session nodrag nowheel nopan">
      <p className="detached-title">세션 없음</p>
      <p className="detached-body">
        이 노드의 tmux 세션(<code>{node.terminal.tmuxSession}</code>)이 없습니다.
        <br />
        앱이나 기기를 다시 시작하면서 사라졌을 수 있어요.
      </p>
      <div className="detached-actions">
        <button type="button" className="detached-button" onClick={onStart}>
          새로 시작
        </button>
        {node.terminal.claudeSessionId !== null && (
          <button
            type="button"
            className="detached-button secondary"
            onClick={onResume}
            title={`claude --resume ${node.terminal.claudeSessionId}`}
          >
            이전 대화 이어서
          </button>
        )}
      </div>
    </div>
  )
}

export default DetachedSession
