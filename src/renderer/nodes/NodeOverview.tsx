import type { TerminalNodeData } from '@shared/types'
import { displayTitle } from './displayTitle'
import { presentStatus } from './statusPresentation'

interface NodeOverviewProps {
  node: TerminalNodeData
  state: Parameters<typeof presentStatus>[0]
}

/**
 * 개요 단계 카드 (SPEC 7.3) — 터미널을 숨기고 **큰 제목 + 설명 + 상태 배지**만
 * 보여준다. 멀리서도 어느 세션이 뭘 하는지 알아볼 수 있어야 한다.
 */
function NodeOverview({ node, state }: NodeOverviewProps): React.JSX.Element {
  const status = presentStatus(state)
  return (
    <div className="node-overview nodrag nowheel nopan">
      <p className={`node-overview-status ${status.className}`}>
        <span aria-hidden="true">{status.symbol}</span> {status.label}
      </p>
      <p className="node-overview-title">{displayTitle(node)}</p>
      {node.description.length > 0 && (
        <p className="node-overview-description">{node.description}</p>
      )}
    </div>
  )
}

export default NodeOverview
