import { memo, useCallback } from 'react'
import { NodeResizer, useReactFlow, type NodeProps, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '@shared/types'
import { MIN_NODE_SIZE, useWorkspace } from '../state/workspace'
import { dispose, fitAndResize, focus, focusedNode } from '../terminal/TerminalRegistry'
import XtermView from '../terminal/XtermView'
import NodeHeader from './NodeHeader'
import NodeDescription from './NodeDescription'
import DetachedSession from './DetachedSession'
import NodeOverview from './NodeOverview'
import { acceptsInput, ZOOM_TO_NODE } from '../canvas/zoomLevel'

export type TerminalFlowNode = Node<{ node: TerminalNodeData }, 'terminal'>

/**
 * 캔버스 위의 터미널 노드 (SPEC 7.1).
 * 헤더로만 드래그하고, 터미널 영역은 캔버스 조작에서 뺀다.
 */
function TerminalNode({ data, selected }: NodeProps<TerminalFlowNode>): React.JSX.Element {
  const { node } = data
  const removeNode = useWorkspace((s) => s.removeNode)
  const updateNode = useWorkspace((s) => s.updateNode)
  const sessionMissing = useWorkspace((s) => s.missingSessions.has(node.id))
  const markSessionStarted = useWorkspace((s) => s.markSessionStarted)
  const status = useWorkspace((s) => s.statuses[node.id])
  const markSeen = useWorkspace((s) => s.markSeen)
  const zoomLevel = useWorkspace((s) => s.zoomLevel)
  const { setCenter } = useReactFlow()

  const zoomToNode = useCallback(() => {
    // SPEC 7.3: 노드가 화면에 들어오도록 줌 1.0으로 이동한 뒤 포커스.
    void setCenter(
      node.position.x + node.size.width / 2,
      node.position.y + node.size.height / 2,
      ZOOM_TO_NODE
    ).then(() => focus(node.id))
  }, [node.id, node.position.x, node.position.y, node.size.width, node.size.height, setCenter])

  /**
   * 이전 Claude Code 대화를 이어서 새 세션을 띄운다 (SPEC 5.4).
   * `command`를 `claude --resume <id>`로 바꾸면 다음 `pty.open`이 그걸 쓴다.
   */
  const resumeSession = useCallback(() => {
    if (node.claudeSessionId === null) return
    updateNode(node.id, { command: `claude --resume ${node.claudeSessionId}` })
    markSessionStarted(node.id)
  }, [node.claudeSessionId, node.id, markSessionStarted, updateNode])

  /** 닫기(분리): PTY만 끊고 tmux 세션은 살려 둔다 (SPEC 5.3). */
  const detachNode = useCallback(() => {
    dispose(node.id, 'detach')
    removeNode(node.id)
  }, [node.id, removeNode])

  /** 세션 종료: tmux 세션까지 끝낸다. 확인을 거친 뒤에만 (SPEC 5.3). */
  const killNode = useCallback(() => {
    dispose(node.id, 'kill')
    removeNode(node.id)
  }, [node.id, removeNode])

  return (
    <div
      className={`terminal-node zoom-${zoomLevel}`}
      onMouseDown={() => {
        // 상세 단계가 아니면 클릭이 곧 "이 노드로 줌인"이다 (SPEC 7.3).
        if (!acceptsInput(zoomLevel)) {
          zoomToNode()
          return
        }
        focus(node.id)
        // SPEC 8.1: 포커스하면 unseen이 풀리고 `done`은 `unknown`으로 내려간다.
        markSeen(node.id)
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={MIN_NODE_SIZE.width}
        minHeight={MIN_NODE_SIZE.height}
        onResize={(_event, params) => {
          updateNode(node.id, { size: { width: params.width, height: params.height } })
        }}
        // 리사이즈가 끝나면 fit → pty.resize (SPEC 7.1).
        onResizeEnd={() => fitAndResize(node.id)}
      />
      <NodeHeader
        node={node}
        sessionMissing={sessionMissing}
        state={status?.state ?? 'unknown'}
        unseen={status?.unseen ?? false}
        focused={focusedNode() === node.id}
        onZoomToNode={zoomToNode}
        onDetach={detachNode}
        onKill={killNode}
      />
      {zoomLevel === 'overview' ? (
        // 개요 단계: 터미널을 아예 그리지 않는다. 버퍼는 TerminalRegistry가
        // 들고 있으므로(SPEC 6.4) 다시 확대해도 내용이 그대로다.
        <NodeOverview
          node={node}
          state={sessionMissing ? 'detached' : (status?.state ?? 'unknown')}
        />
      ) : (
        <>
          <NodeDescription node={node} />
          {sessionMissing ? (
            <DetachedSession
              node={node}
              onStart={() => markSessionStarted(node.id)}
              onResume={resumeSession}
            />
          ) : (
            <XtermView node={node} />
          )}
        </>
      )}
    </div>
  )
}

export default memo(TerminalNode)
