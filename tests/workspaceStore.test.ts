import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../src/main/workspace/WorkspaceStore'
import { emptyWorkspace, parseWorkspace, serializeWorkspace } from '../src/main/workspace/serialize'
import type { TerminalNodeData, Workspace } from '../src/shared/types'

function node(id: string): TerminalNodeData {
  return {
    id,
    title: '제목',
    description: '설명\n두 줄',
    cwd: '/Users/me/내 프로젝트',
    command: 'claude',
    tmuxSession: `sc-${id}`,
    claudeSessionId: null,
    position: { x: 10, y: 20 },
    size: { width: 700, height: 500 },
    color: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  }
}

function sample(): Workspace {
  return { ...emptyWorkspace(), viewport: { x: 5, y: 6, zoom: 0.8 }, nodes: [node('abcDEF1234')] }
}

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-canvas-test-'))
  file = join(dir, 'workspace.json')
})

describe('serialize (SPEC 9.2)', () => {
  it('저장 → 로드 왕복이 동일하다', () => {
    const original = sample()
    const parsed = parseWorkspace(serializeWorkspace(original))
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace).toEqual(original)
  })

  it('모자란 필드는 기본값으로 채운다', () => {
    const parsed = parseWorkspace('{"version":1}')
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.nodes).toEqual([])
    expect(parsed.workspace.settings.fontSize).toBe(13)
    expect(parsed.workspace.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  // 노드 id는 tmux 세션 이름과 훅 상태 파일 경로가 된다 (SPEC 8.3/11).
  it('id가 패턴에 맞지 않는 노드는 버린다', () => {
    const raw = JSON.stringify({
      version: 1,
      nodes: [
        node('good12345X'),
        { ...node('x'), id: '../../etc/passwd' },
        { ...node('y'), id: '' }
      ]
    })
    const parsed = parseWorkspace(raw)
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.nodes.map((n) => n.id)).toEqual(['good12345X'])
  })

  it('상위 버전은 읽지 않는다', () => {
    expect(parseWorkspace('{"version":99}')).toEqual({ status: 'unsupported-version', version: 99 })
  })

  it('깨진 JSON과 이상한 최상위 값은 corrupt', () => {
    expect(parseWorkspace('{nope').status).toBe('corrupt')
    expect(parseWorkspace('[]').status).toBe('corrupt')
    expect(parseWorkspace('{"version":0}').status).toBe('corrupt')
  })
})

describe('WorkspaceStore (SPEC 9.2)', () => {
  it('파일이 없으면 빈 워크스페이스로 시작한다', async () => {
    const result = await new WorkspaceStore(file).load()
    expect(result.status).toBe('empty')
    expect(result.workspace.nodes).toEqual([])
  })

  it('저장한 뒤 다시 읽으면 그대로다', async () => {
    const store = new WorkspaceStore(file)
    store.save(sample())
    await store.flush()

    const result = await new WorkspaceStore(file).load()
    expect(result.status).toBe('ok')
    expect(result.workspace).toEqual(sample())
  })

  it('두 번째 저장부터 직전 버전을 .bak로 남긴다', async () => {
    const store = new WorkspaceStore(file)
    store.save(sample())
    await store.flush()
    store.save({ ...sample(), nodes: [] })
    await store.flush()

    const backup = parseWorkspace(await readFile(`${file}.bak`, 'utf8'))
    expect(backup.status).toBe('ok')
    if (backup.status !== 'ok') return
    expect(backup.workspace.nodes).toHaveLength(1)
  })

  it('손상된 파일은 .bak에서 복구하고 원본을 보존한다', async () => {
    const store = new WorkspaceStore(file)
    store.save(sample())
    await store.flush()
    store.save({ ...sample(), nodes: [] })
    await store.flush()
    await writeFile(file, '{ 깨진 파일', 'utf8')

    const result = await new WorkspaceStore(file).load()
    expect(result.status).toBe('recovered-from-backup')
    expect(result.workspace.nodes).toHaveLength(1)
    expect(result.message).toContain('복구')
    expect((await readdir(dir)).some((name) => name.startsWith('workspace.corrupt-'))).toBe(true)
  })

  it('백업도 없으면 빈 워크스페이스로 시작하되 손상 파일은 남긴다', async () => {
    await writeFile(file, 'not json at all', 'utf8')
    const result = await new WorkspaceStore(file).load()
    expect(result.status).toBe('corrupt')
    expect(result.workspace.nodes).toEqual([])
    expect((await readdir(dir)).some((name) => name.startsWith('workspace.corrupt-'))).toBe(true)
  })

  it('상위 버전 파일은 읽기 전용이 되어 덮어쓰지 않는다', async () => {
    await writeFile(file, '{"version":99,"nodes":[]}', 'utf8')
    const store = new WorkspaceStore(file)
    const result = await store.load()
    expect(result.status).toBe('unsupported-version')

    store.save(sample())
    await store.flush()
    expect(await readFile(file, 'utf8')).toBe('{"version":99,"nodes":[]}')
  })

  it('연속 저장은 마지막 값만 쓴다 (디바운스)', async () => {
    const store = new WorkspaceStore(file)
    store.save({ ...sample(), nodes: [node('first12345')] })
    store.save({ ...sample(), nodes: [node('second1234')] })
    store.save({ ...sample(), nodes: [node('third12345')] })
    await store.flush()

    const result = await new WorkspaceStore(file).load()
    expect(result.workspace.nodes.map((n) => n.id)).toEqual(['third12345'])
  })
})
