import { useEffect, useRef, useState } from 'react'
import type { SessionState, TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { useWorkLog } from '../state/workLog'
import { displayTitle } from './displayTitle'
import { presentStatus } from './statusPresentation'
import NodeLocation from './NodeLocation'

/** 색 라벨 선택지 (SPEC 7.1). 상태 색과 헷갈리지 않게 채도를 낮춰 잡았다. */
const COLOR_LABELS = ['#c96f6f', '#c9a36f', '#8fb86f', '#6fb8b0', '#6f8fc9', '#a98fc9'] as const

interface NodeHeaderProps {
  node: TerminalNodeData
  sessionMissing: boolean
  state: SessionState
  unseen: boolean
  focused: boolean
  onZoomToNode(): void
  /** 닫기(분리) — tmux 세션은 살아남는다 (SPEC 5.3). */
  onDetach(): void
  /** 세션 종료 — `tmux kill-session`. 확인을 거친 뒤에만. */
  onKill(): void
}

/**
 * 노드 헤더 (SPEC 7.1). 캔버스 드래그 핸들이기도 하다.
 */
function NodeHeader({
  node,
  sessionMissing,
  state,
  unseen,
  focused,
  onZoomToNode,
  onDetach,
  onKill
}: NodeHeaderProps): React.JSX.Element {
  const updateNode = useWorkspace((s) => s.updateNode)
  // 패널이 읽어 둔 것을 그대로 쓴다 — 헤더가 따로 읽지 않는다.
  const activity = useWorkLog((s) => s.views[node.id]?.activity ?? null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [pickingColor, setPickingColor] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const status = presentStatus(sessionMissing ? 'detached' : state)

  useEffect(() => {
    if (editingTitle) titleRef.current?.select()
  }, [editingTitle])

  return (
    <div className="node-header drag-handle">
      {/* SPEC 7.1: 색 라벨은 헤더 좌측 띠. */}
      {node.color !== null && (
        <span className="node-color-stripe" style={{ background: node.color }} />
      )}

      <div className="node-header-rows">
        <div className="node-header-row">
          <div className="node-header-main">
            {/* SPEC 8.1: 기호 + 문구 + 색을 함께 보여준다. 색만으로 전달하지 않는다. */}
            <span className={`node-badge ${status.className}${unseen ? ' unseen' : ''}`}>
              <span aria-hidden="true">{status.symbol}</span>
              <span className="node-badge-label">{status.label}</span>
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
            // 분리가 기본이고, 세션을 정말 끝내는 것은 따로 고르게 한다 (SPEC 5.3).
            <div className="node-confirm nodrag">
              <button
                type="button"
                className="node-button"
                onClick={onDetach}
                title="tmux 세션은 살아 있습니다"
              >
                닫기(분리)
              </button>
              <button
                type="button"
                className="node-button danger"
                onClick={onKill}
                title="tmux 세션까지 끝냅니다"
              >
                세션 종료
              </button>
              <button
                type="button"
                className="node-button"
                onClick={() => setConfirmingClose(false)}
              >
                취소
              </button>
            </div>
          ) : pickingColor ? (
            <div className="node-colors nodrag">
              {COLOR_LABELS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="node-color-swatch"
                  style={{ background: color }}
                  title={`색 라벨 ${color}`}
                  onClick={() => {
                    updateNode(node.id, { color })
                    setPickingColor(false)
                  }}
                />
              ))}
              <button
                type="button"
                className="node-button"
                onClick={() => {
                  updateNode(node.id, { color: null })
                  setPickingColor(false)
                }}
                title="색 라벨 지우기"
              >
                없음
              </button>
            </div>
          ) : (
            <div className="node-actions nodrag">
              <button
                type="button"
                className="node-button"
                onClick={() => setPickingColor(true)}
                title="색 라벨"
              >
                ◍
              </button>
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

        <NodeLocation node={node} active={focused} />
      </div>
      {/*
        "지금" 줄 (SPEC 19 단계 8 / 21.4). 제목은 `ai-title`이라 세션 시작
        시점에 고정되어 낡는다 — 이 줄이 현재를 가리켜 그 약점을 메운다.
        읽지 못했거나 아직 없으면 줄 자체를 띄우지 않는다.
      */}
      {activity !== null && (
        <div className="node-now" title={activity}>
          {activity}
        </div>
      )}
    </div>
  )
}

export default NodeHeader
