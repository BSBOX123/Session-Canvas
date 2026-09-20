import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type Viewport
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TerminalNode, { type TerminalFlowNode } from '../nodes/TerminalNode'
import NewNodeDialog from '../nodes/NewNodeDialog'
import { useWorkspace, type NewNodeInput } from '../state/workspace'
import { focus } from '../terminal/TerminalRegistry'

/** 모듈 최상단에 두어야 매 렌더마다 새 객체가 되지 않는다. */
const nodeTypes = { terminal: TerminalNode }

function CanvasInner(): React.JSX.Element {
  const nodes = useWorkspace((s) => s.nodes)
  const addNode = useWorkspace((s) => s.addNode)
  const updateNode = useWorkspace((s) => s.updateNode)
  const setViewport = useWorkspace((s) => s.setViewport)
  const { screenToFlowPosition } = useReactFlow()

  const [dialogPosition, setDialogPosition] = useState<{ x: number; y: number } | null>(null)
  // 선택은 화면 상태일 뿐이라 워크스페이스(SPEC 9.1)에 넣지 않는다. 다만
  // ReactFlow가 제어 모드이므로 여기서 들고 있지 않으면 선택이 살지 않고,
  // NodeResizer(선택 시에만 보임)도 영영 안 나타난다.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const wrapperRef = useRef<HTMLDivElement>(null)

  const flowNodes: TerminalFlowNode[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'terminal' as const,
        position: node.position,
        width: node.size.width,
        height: node.size.height,
        selected: selectedIds.has(node.id),
        // SPEC 7.1: 드래그는 헤더로만.
        dragHandle: '.drag-handle',
        data: { node }
      })),
    [nodes, selectedIds]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<TerminalFlowNode>[]) => {
      const selectChanges = changes.filter((change) => change.type === 'select')
      if (selectChanges.length > 0) {
        setSelectedIds((previous) => {
          const next = new Set(previous)
          for (const change of selectChanges) {
            if (change.selected) next.add(change.id)
            else next.delete(change.id)
          }
          return next
        })
      }

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateNode(change.id, { position: change.position })
        }
        if (change.type === 'dimensions' && change.dimensions) {
          updateNode(change.id, {
            size: { width: change.dimensions.width, height: change.dimensions.height }
          })
        }
      }
    },
    [updateNode]
  )

  const openDialogAt = useCallback(
    (clientX?: number, clientY?: number) => {
      const position =
        clientX === undefined || clientY === undefined
          ? screenToFlowPosition({
              x: (wrapperRef.current?.clientWidth ?? 800) / 2,
              y: (wrapperRef.current?.clientHeight ?? 600) / 2
            })
          : screenToFlowPosition({ x: clientX, y: clientY })
      setDialogPosition(position)
    },
    [screenToFlowPosition]
  )

  const create = useCallback(
    (input: Omit<NewNodeInput, 'position'>) => {
      if (dialogPosition === null) return
      const node = addNode({ ...input, position: dialogPosition })
      setDialogPosition(null)
      // 터미널이 붙은 뒤에 포커스를 준다.
      window.setTimeout(() => focus(node.id), 100)
    },
    [addNode, dialogPosition]
  )

  // SPEC 7.5: 앱 단축키는 Cmd 조합만 쓴다. Esc·Shift+Tab·Ctrl+*·Option+* 은
  // 포커스된 터미널이 그대로 받아야 하므로 절대 가로채지 않는다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      openDialogAt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openDialogAt])

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <ReactFlow<TerminalFlowNode>
        nodes={flowNodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onMoveEnd={(_event, viewport: Viewport) => setViewport(viewport)}
        onDoubleClick={(event) => {
          // 빈 캔버스 더블클릭으로 생성 (SPEC 7.2).
          if ((event.target as HTMLElement).closest('.terminal-node') === null) {
            openDialogAt(event.clientX, event.clientY)
          }
        }}
        // SPEC 7.4: 두 손가락 스크롤은 캔버스 팬, 핀치는 줌.
        // 포인터가 터미널 위면 `nowheel` 덕분에 여기로 오지 않고 터미널이 받는다.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        // 터미널이 Backspace를 쓰기 때문에 노드 삭제 단축키를 비운다.
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#2b3a4a" maskColor="rgba(0,0,0,0.5)" />
      </ReactFlow>

      {nodes.length === 0 && dialogPosition === null && (
        <div className="empty-hint">
          빈 곳을 더블클릭하거나 <kbd>⌘N</kbd> 으로 터미널 노드를 만드세요
        </div>
      )}

      {dialogPosition !== null && (
        <NewNodeDialog onCancel={() => setDialogPosition(null)} onCreate={create} />
      )}
    </div>
  )
}

function Canvas(): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

export default Canvas
