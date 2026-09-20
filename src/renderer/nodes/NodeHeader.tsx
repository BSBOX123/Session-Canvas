import { useEffect, useRef, useState } from 'react'
import type { TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { displayTitle } from './displayTitle'

interface NodeHeaderProps {
  node: TerminalNodeData
  onZoomToNode(): void
  onClose(): void
}

/**
 * 노드 헤더 (SPEC 7.1). 캔버스 드래그 핸들이기도 하다.
 * 상태 배지는 단계 4, git 브랜치·색 라벨은 단계 6.
 */
function NodeHeader({ node, onZoomToNode, onClose }: NodeHeaderProps): React.JSX.Element {
  const updateNode = useWorkspace((s) => s.updateNode)
  const [editingTitle, setEditingTitle] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTitle) titleRef.current?.select()
  }, [editingTitle])

  return (
    <div className="node-header drag-handle">
      <div className="node-header-main">
        <span className="node-badge" title="상태 감지는 단계 4에서 붙는다">
          ○
        </span>
        {editingTitle ? (
          <input
            ref={titleRef}
            className="node-title-input nodrag"
            defaultValue={node.title}
            placeholder={displayTitle(node)}
            onBlur={(e) => {
              updateNode(node.id, { title: e.target.value })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <button
            type="button"
            className="node-title nodrag"
            onClick={() => setEditingTitle(true)}
            title="클릭해서 제목 편집"
          >
            {displayTitle(node)}
          </button>
        )}
      </div>

      {confirmingClose ? (
        <div className="node-confirm nodrag">
          <span>세션을 끝낼까요?</span>
          <button type="button" className="node-button danger" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="node-button" onClick={() => setConfirmingClose(false)}>
            취소
          </button>
        </div>
      ) : (
        <div className="node-actions nodrag">
          <button
            type="button"
            className="node-button"
            onClick={onZoomToNode}
            title="이 노드로 줌인"
          >
            ⤢
          </button>
          <button
            type="button"
            className="node-button"
            onClick={() => setConfirmingClose(true)}
            title="노드 닫기"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

export default NodeHeader
