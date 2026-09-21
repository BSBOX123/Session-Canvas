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
import OrphanSessions from './OrphanSessions'
import SettingsPanel from '../settings/SettingsPanel'
import { useWorkspace, type NewNodeInput } from '../state/workspace'
import { focus } from '../terminal/TerminalRegistry'
import { zoomLevelOf } from './zoomLevel'
import { useShortcuts } from '../shortcuts/useShortcuts'

/** 모듈 최상단에 두어야 매 렌더마다 새 객체가 되지 않는다. */
const nodeTypes = { terminal: TerminalNode }

/** 두 손가락 스크롤 팬 속도. React Flow 기본값 0.5는 트랙패드에서 답답하다. */
const PAN_ON_SCROLL_SPEED = 1.2

/** SPEC 8.1의 상태 색. 미니맵에서도 같은 색을 쓴다. */
const STATUS_COLORS: Record<string, string> = {
  unknown: '#2b3a4a',
  working: '#6ba8ff',
  waiting: '#ffa94d',
  done: '#64c98a',
  detached: '#3a3f47'
}

function CanvasInner(): React.JSX.Element {
  const nodes = useWorkspace((s) => s.nodes)
  const addNode = useWorkspace((s) => s.addNode)
  const updateNode = useWorkspace((s) => s.updateNode)
  const setViewport = useWorkspace((s) => s.setViewport)
  const viewport = useWorkspace((s) => s.viewport)
  const notice = useWorkspace((s) => s.notice)
  const setZoomLevel = useWorkspace((s) => s.setZoomLevel)
  const statuses = useWorkspace((s) => s.statuses)
  const missingSessions = useWorkspace((s) => s.missingSessions)

  const miniMapColor = useCallback(
    (flowNode: TerminalFlowNode): string => {
      if (missingSessions.has(flowNode.id)) return STATUS_COLORS.detached
      return STATUS_COLORS[statuses[flowNode.id]?.state ?? 'unknown'] ?? STATUS_COLORS.unknown
    },
    [missingSessions, statuses]
  )
  const dismissNotice = useWorkspace((s) => s.dismissNotice)
  const { screenToFlowPosition, setCenter } = useReactFlow()

  const [dialogPosition, setDialogPosition] = useState<{ x: number; y: number } | null>(null)
  // 선택은 화면 상태일 뿐이라 워크스페이스(SPEC 9.1)에 넣지 않는다. 다만
  // ReactFlow가 제어 모드이므로 여기서 들고 있지 않으면 선택이 살지 않고,
  // NodeResizer(선택 시에만 보임)도 영영 안 나타난다.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  /** 리사이즈 드래그가 진행 중인가. 그동안은 스토어를 갱신하지 않는다. */
  const resizingRef = useRef(false)

  const flowNodes: TerminalFlowNode[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'terminal' as const,
        position: node.position,
        width: node.size.width,
        height: node.size.height,
        // React Flow는 `adoptUserNodes`에서 우리가 넘긴 객체의 `measured`만
        // 살려 둔다. 여기서 안 넘기면 스토어가 바뀔 때마다 `measured`가
        // undefined로 지워지고, 그 상태로 리사이즈를 시작하면 기준 크기가
        // 0이 되어 최소 크기로 튄다. 노드 DOM 크기는 곧 `size`이므로 같은
        // 값을 준다.
        measured: { width: node.size.width, height: node.size.height },
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

      // 리사이즈 중에는 `NodeResizer`의 `onResize`가 직접 스토어에 넣는다.
      // 여기서 또 쓰면 같은 값을 두 번 쓰는 셈이라 렌더만 늘어난다.
      for (const change of changes) {
        if (change.type === 'dimensions' && change.resizing !== undefined) {
          resizingRef.current = change.resizing
        }
      }
      if (resizingRef.current) return

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

  useShortcuts({ openNewNodeDialog: openDialogAt })

  // 개발 모드 점검용 (SPEC 14.3).
  const { zoomTo } = useReactFlow()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    void import('../devBridge').then(({ registerCanvasDevHelpers }) => {
      registerCanvasDevHelpers({
        zoomTo: async (zoom: number) => {
          await zoomTo(zoom, { duration: 0 })
          setZoomLevel(zoomLevelOf(zoom))
        }
      })
    })
  }, [setZoomLevel, zoomTo])

  // 알림을 클릭하면 그 노드로 줌인한다 (SPEC 8.6).
  useEffect(() => {
    const onFocusNode = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const node = useWorkspace.getState().nodes.find((n) => n.id === id)
      if (!node) return
      void setCenter(
        node.position.x + node.size.width / 2,
        node.position.y + node.size.height / 2,
        {
          zoom: 1,
          duration: 200
        }
      ).then(() => focus(id))
    }
    window.addEventListener('session-canvas:focus-node', onFocusNode)
    return () => window.removeEventListener('session-canvas:focus-node', onFocusNode)
  }, [setCenter])

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <ReactFlow<TerminalFlowNode>
        nodes={flowNodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onMove={(_event, viewport: Viewport) => setZoomLevel(zoomLevelOf(viewport.zoom))}
        onMoveEnd={(_event, viewport: Viewport) => {
          setViewport(viewport)
          setZoomLevel(zoomLevelOf(viewport.zoom))
        }}
        onDoubleClick={(event) => {
          // 빈 캔버스 더블클릭으로 생성 (SPEC 7.2).
          if ((event.target as HTMLElement).closest('.terminal-node') === null) {
            openDialogAt(event.clientX, event.clientY)
          }
        }}
        // SPEC 7.4: 두 손가락 스크롤은 캔버스 팬, 핀치는 줌.
        // 포인터가 터미널 위면 `nowheel` 덕분에 여기로 오지 않고 터미널이 받는다.
        panOnScroll
        panOnScrollSpeed={PAN_ON_SCROLL_SPEED}
        zoomOnScroll={false}
        zoomOnPinch
        // 터미널이 Backspace를 쓰기 때문에 노드 삭제 단축키를 비운다.
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        defaultViewport={viewport}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        {/* SPEC 7.4: 미니맵은 노드를 상태 색으로 표시한다. */}
        <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(0,0,0,0.5)" />
      </ReactFlow>

      <button
        type="button"
        className="settings-button"
        onClick={() => setSettingsOpen(true)}
        title="설정"
      >
        ⚙
      </button>

      <OrphanSessions />

      {notice !== null && (
        <div className="notice">
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice}>
            닫기
          </button>
        </div>
      )}

      {nodes.length === 0 && dialogPosition === null && (
        <div className="empty-hint">
          빈 곳을 더블클릭하거나 <kbd>⌘N</kbd> 으로 터미널 노드를 만드세요
        </div>
      )}

      {dialogPosition !== null && (
        <NewNodeDialog onCancel={() => setDialogPosition(null)} onCreate={create} />
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
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
