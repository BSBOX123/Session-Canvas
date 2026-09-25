import { describe, expect, it } from 'vitest'
import type { NodeRuntime } from '../src/renderer/nodes/nodeRuntime'

/**
 * SPEC 18.3 — 두 번째 노드 종류가 따라갈 모양을 고정한다.
 * 런타임 자체는 DOM과 xterm이 필요해 단위 테스트로 돌리지 않는다.
 */
describe('NodeRuntime 계약', () => {
  it('acquire / get / dispose / survivesUnmount 를 갖는다', () => {
    const entries = new Map<string, { value: number }>()
    const runtime: NodeRuntime<{ value: number }, { id: string }> = {
      acquire(node) {
        const existing = entries.get(node.id)
        if (existing) return existing
        const created = { value: 1 }
        entries.set(node.id, created)
        return created
      },
      get: (id) => entries.get(id),
      dispose: (id) => void entries.delete(id),
      survivesUnmount: true
    }

    const container = null as unknown as HTMLElement
    const first = runtime.acquire({ id: 'a' }, container)
    // 같은 노드를 다시 acquire해도 같은 자원이어야 한다 (SPEC 6.4).
    expect(runtime.acquire({ id: 'a' }, container)).toBe(first)
    expect(runtime.get('a')).toBe(first)

    runtime.dispose('a', 'detach')
    expect(runtime.get('a')).toBeUndefined()
  })
})
