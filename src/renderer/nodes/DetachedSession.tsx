import type { TerminalNodeData } from '@shared/types'

interface DetachedSessionProps {
  node: TerminalNodeData
  onStart(): void
}

/**
 * 워크스페이스에는 있는데 tmux 세션이 없는 노드 (SPEC 5.4).
 * 재부팅 등으로 tmux 서버가 사라졌을 때다.
 *
 * [이전 대화 이어서]는 `claudeSessionId`가 있을 때만 의미가 있는데, 그 값은
 * 단계 4의 훅에서 채워진다. 그때까지는 [새로 시작]만 보여준다.
 */
function DetachedSession({ node, onStart }: DetachedSessionProps): React.JSX.Element {
  return (
    <div className="detached-session nodrag nowheel nopan">
      <p className="detached-title">세션 없음</p>
      <p className="detached-body">
        이 노드의 tmux 세션(<code>{node.tmuxSession}</code>)이 없습니다.
        <br />
        앱이나 기기를 다시 시작하면서 사라졌을 수 있어요.
      </p>
      <button type="button" className="detached-button" onClick={onStart}>
        새로 시작
      </button>
    </div>
  )
}

export default DetachedSession
