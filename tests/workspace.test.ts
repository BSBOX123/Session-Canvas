import { beforeEach, describe, expect, it } from 'vitest'
import { NODE_ID_PATTERN } from '../src/shared/types'
import { useWorkspace } from '../src/renderer/state/workspace'

const base = { title: '', command: null, cwd: '/tmp' }

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspace.setState({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 } })
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
