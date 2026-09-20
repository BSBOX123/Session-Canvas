import { useEffect, useRef, useState } from 'react'
import type { TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'

/**
 * 설명 (SPEC 7.1) — 여러 줄 평문. 접힌 상태에서는 2줄 + 말줄임,
 * 클릭하면 편집.
 */
function NodeDescription({ node }: { node: TerminalNodeData }): React.JSX.Element {
  const updateNode = useWorkspace((s) => s.updateNode)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="node-description-input nodrag nowheel"
        defaultValue={node.description}
        placeholder="이 세션이 무슨 작업인지 적어두세요"
        onBlur={(e) => {
          updateNode(node.id, { description: e.target.value })
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={`node-description nodrag${node.description ? '' : ' empty'}`}
      onClick={() => setEditing(true)}
      title="클릭해서 설명 편집"
    >
      {node.description || '설명 추가…'}
    </button>
  )
}

export default NodeDescription
