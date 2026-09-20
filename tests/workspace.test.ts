import { beforeEach, describe, expect, it } from 'vitest'
import { NODE_ID_PATTERN, type SessionState } from '../src/shared/types'
import { useWorkspace } from '../src/renderer/state/workspace'

const base = { title: '', command: null, cwd: '/tmp' }

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspace.setState({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 }, statuses: {} })
  })

  it('노드 id가 IPC 검증 패턴을 만족한다 (SPEC 9.1/11)', () => {
    const node = useWorkspace.getState().addNode({ ...base, position: { x: 0, y: 0 } })
    expect(node.id).toMatch(NODE_ID_PATTERN)
    expect(node.id).toHaveLength(10)
    expect(node.tmuxSession).toBe(`sc-${node.id}`)
  })

  // SPEC 7.2: 기존 노드와 겹치면 오른쪽으로 밀어 배치한다.
  it('같은 자리에 만들면 오른쪽으로 밀어 놓는다', () => {
    const { addNode } = useWorkspace.getState()
    const first = addNode({ ...base, position: { x: 100, y: 100 } })
    const second = addNode({ ...base, position: { x: 100, y: 100 } })
    const third = addNode({ ...base, position: { x: 100, y: 100 } })

    expect(first.position).toEqual({ x: 100, y: 100 })
    expect(second.position.x).toBeGreaterThanOrEqual(first.position.x + first.size.width)
    expect(third.position.x).toBeGreaterThanOrEqual(second.position.x + second.size.width)
    expect(second.position.y).toBe(100)
  })

  it('겹치지 않는 자리는 그대로 둔다', () => {
    const { addNode } = useWorkspace.getState()
    addNode({ ...base, position: { x: 0, y: 0 } })
    const far = addNode({ ...base, position: { x: 2000, y: 2000 } })
    expect(far.position).toEqual({ x: 2000, y: 2000 })
  })

  it('updateNode는 해당 노드만 바꾸고 updatedAt을 올린다', async () => {
    const node = useWorkspace.getState().addNode({ ...base, position: { x: 0, y: 0 } })
    const other = useWorkspace.getState().addNode({ ...base, position: { x: 2000, y: 0 } })
    await new Promise((resolve) => setTimeout(resolve, 2))

    useWorkspace.getState().updateNode(node.id, { title: '바뀐 제목' })
    const [updated, untouched] = useWorkspace.getState().nodes

    expect(updated.title).toBe('바뀐 제목')
    expect(updated.updatedAt >= node.updatedAt).toBe(true)
    expect(untouched).toEqual(other)
  })

  it('removeNode는 그 노드만 지운다', () => {
    const { addNode, removeNode } = useWorkspace.getState()
    const a = addNode({ ...base, position: { x: 0, y: 0 } })
    const b = addNode({ ...base, position: { x: 2000, y: 0 } })

    removeNode(a.id)
    expect(useWorkspace.getState().nodes.map((n) => n.id)).toEqual([b.id])
  })
})

// SPEC 14.1 — 상태 전이: unseen 설정·해제, 포커스 시 done → unknown
describe('상태 전이 (SPEC 8.1)', () => {
  beforeEach(() => {
    useWorkspace.setState({ nodes: [], statuses: {} })
  })

  function addNode(): string {
    return useWorkspace.getState().addNode({ ...base, position: { x: 0, y: 0 } }).id
  }

  function apply(id: string, state: SessionState, claudeSessionId: string | null = null): void {
    useWorkspace
      .getState()
      .applyStatus({ nodeId: id, state, at: new Date().toISOString(), claudeSessionId })
  }

  it('waiting과 done만 unseen이 된다', () => {
    const id = addNode()
    for (const [state, unseen] of [
      ['working', false],
      ['waiting', true],
      ['unknown', false],
      ['done', true]
    ] as const) {
      apply(id, state)
      expect(useWorkspace.getState().statuses[id]).toMatchObject({ state, unseen })
    }
  })

  it('포커스하면 unseen이 풀리고 done은 unknown으로 내려간다', () => {
    const id = addNode()
    apply(id, 'done')
    useWorkspace.getState().markSeen(id)
    expect(useWorkspace.getState().statuses[id]).toMatchObject({ state: 'unknown', unseen: false })
  })

  it('포커스해도 waiting은 상태를 유지한 채 unseen만 풀린다', () => {
    const id = addNode()
    apply(id, 'waiting')
    useWorkspace.getState().markSeen(id)
    expect(useWorkspace.getState().statuses[id]).toMatchObject({ state: 'waiting', unseen: false })
  })

  it('working에 포커스해도 아무것도 바뀌지 않는다', () => {
    const id = addNode()
    apply(id, 'working')
    const before = useWorkspace.getState().statuses[id]
    useWorkspace.getState().markSeen(id)
    expect(useWorkspace.getState().statuses[id]).toBe(before)
  })

  it('SessionStart의 session_id를 노드에 저장한다 (SPEC 5.4)', () => {
    const id = addNode()
    apply(id, 'unknown', 'sess-abc')
    expect(useWorkspace.getState().nodes[0].claudeSessionId).toBe('sess-abc')
  })

  // 훅은 앱이 모르는 노드에도 파일을 쓸 수 있다 (닫은 노드 등).
  it('워크스페이스에 없는 노드의 이벤트는 버린다', () => {
    apply('ghost12345', 'waiting')
    expect(useWorkspace.getState().statuses).toEqual({})
  })

  it('노드를 지우면 그 노드 상태도 더는 쌓이지 않는다', () => {
    const id = addNode()
    apply(id, 'waiting')
    useWorkspace.getState().removeNode(id)
    apply(id, 'done')
    expect(useWorkspace.getState().statuses[id].state).toBe('waiting')
  })
})
