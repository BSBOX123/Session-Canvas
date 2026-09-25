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
    kind: 'terminal',
    title: '제목',
    description: '설명\n두 줄',
    position: { x: 10, y: 20 },
    size: { width: 700, height: 500 },
    z: 0,
    parentId: null,
    color: null,
    locked: false,
    hidden: false,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    terminal: {
      cwd: '/Users/me/내 프로젝트',
      command: 'claude',
      tmuxSession: `sc-${id}`,
      claudeSessionId: null
    }
  }
}

/** v1 시절의 평평한 노드. 마이그레이션 확인에 쓴다 (SPEC 18.4). */
function v1Node(id: string): Record<string, unknown> {
  return {
    id,
    title: '옛 제목',
    description: '옛 설명',
    cwd: '/Users/me/오래된 프로젝트',
    command: 'claude --resume abc',
    tmuxSession: `sc-${id}`,
    claudeSessionId: 'sess-old',
    position: { x: 11, y: 22 },
    size: { width: 800, height: 600 },
    color: '#c96f6f',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z'
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

  // SPEC 9.1에 `theme`이 뒤늦게 생겼다. 그 전에 저장한 파일도 읽혀야 한다.
  it('theme이 없는 예전 파일은 기본 테마로 채운다', () => {
    const parsed = parseWorkspace(
      JSON.stringify({ version: 1, settings: { fontSize: 15, webglMax: 2 } })
    )
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.settings.theme).toEqual({ preset: 'dark', accent: '#4c8dff' })
    // 같이 있던 다른 설정은 그대로 살아야 한다.
    expect(parsed.workspace.settings.fontSize).toBe(15)
    expect(parsed.workspace.settings.webglMax).toBe(2)
  })

  it('theme이 망가져 있어도 기본값으로 살려 낸다', () => {
    for (const theme of ['문자열', 42, null, [], { preset: 7 }]) {
      const parsed = parseWorkspace(JSON.stringify({ version: 1, settings: { theme } }))
      expect(parsed.status).toBe('ok')
      if (parsed.status !== 'ok') continue
      expect(parsed.workspace.settings.theme.preset).toBe('dark')
      expect(parsed.workspace.settings.theme.accent).toBe('#4c8dff')
    }
  })

  it('고른 테마는 저장→로드 왕복에서 유지된다', () => {
    const chosen = {
      ...sample(),
      settings: { ...sample().settings, theme: { preset: 'latte', accent: '#3fb894' } }
    }
    const parsed = parseWorkspace(serializeWorkspace(chosen))
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.settings.theme).toEqual({ preset: 'latte', accent: '#3fb894' })
  })

  // SPEC 18.4 — v1은 노드가 전부 터미널이고 필드가 평평했다.
  it('v1 파일을 손실 없이 v2로 올려 읽는다', () => {
    const parsed = parseWorkspace(JSON.stringify({ version: 1, nodes: [v1Node('oldNode123')] }))
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return

    expect(parsed.workspace.version).toBe(2)
    const [migrated] = parsed.workspace.nodes
    expect(migrated.kind).toBe('terminal')
    // 공통 필드는 그대로
    expect(migrated.title).toBe('옛 제목')
    expect(migrated.description).toBe('옛 설명')
    expect(migrated.position).toEqual({ x: 11, y: 22 })
    expect(migrated.size).toEqual({ width: 800, height: 600 })
    expect(migrated.color).toBe('#c96f6f')
    expect(migrated.createdAt).toBe('2026-09-01T00:00:00.000Z')
    // 터미널 고유 필드는 payload로 내려간다
    expect(migrated.terminal).toEqual({
      cwd: '/Users/me/오래된 프로젝트',
      command: 'claude --resume abc',
      tmuxSession: 'sc-oldNode123',
      claudeSessionId: 'sess-old'
    })
    // v1에 없던 필드는 기본값
    expect(migrated.z).toBe(0)
    expect(migrated.parentId).toBeNull()
    expect(migrated.locked).toBe(false)
    expect(migrated.hidden).toBe(false)
  })

  it('v1 노드도 id 패턴 검사를 똑같이 받는다', () => {
    const parsed = parseWorkspace(
      JSON.stringify({ version: 1, nodes: [{ ...v1Node('x'), id: '../../etc/passwd' }] })
    )
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.nodes).toEqual([])
  })

  // 나중 버전이 만든 종류를 이 버전이 다룰 수는 없다.
  it('모르는 kind의 노드는 버린다', () => {
    const parsed = parseWorkspace(
      JSON.stringify({ version: 2, nodes: [{ ...node('good123456'), kind: 'db-graph' }] })
    )
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.workspace.nodes).toEqual([])
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
