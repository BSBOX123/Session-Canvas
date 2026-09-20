import { mkdir, mkdtemp, rename, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusWatcher, type StatusChange } from '../src/main/status/StatusWatcher'

let dir = ''
let watcher: StatusWatcher | null = null
let seen: StatusChange[] = []

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'session-canvas-status-')), 'status')
  await mkdir(dir, { recursive: true })
  seen = []
})

afterEach(() => {
  watcher?.stop()
  watcher = null
})

/** 훅과 같은 방식으로 쓴다 — 임시 파일에 쓰고 원자적으로 옮긴다 (SPEC 8.3). */
async function writeStatus(id: string, payload: unknown): Promise<void> {
  const temp = join(dir, `.tmp.${id}`)
  await writeFile(temp, JSON.stringify(payload), 'utf8')
  await rename(temp, join(dir, `${id}.json`))
}

async function start(known: string[], since = new Date(Date.now() - 60_000)): Promise<void> {
  watcher = new StatusWatcher(dir, (change) => seen.push(change))
  watcher.setKnownNodes(known)
  await watcher.start(since)
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`타임아웃: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// SPEC 8.5
describe('StatusWatcher', () => {
  it('파일이 바뀌면 상태를 알린다', async () => {
    await start(['node123'])
    await writeStatus('node123', { hook_event_name: 'UserPromptSubmit' })

    await waitFor(() => seen.length > 0, '상태 변화')
    expect(seen.every((c) => c.nodeId === 'node123' && c.state === 'working')).toBe(true)
  })

  it('시작할 때 이미 있는 파일을 한 번 읽는다', async () => {
    await writeStatus('node123', { hook_event_name: 'Stop' })
    await start(['node123'])

    await waitFor(() => seen.length > 0, '초기 상태')
    expect(seen.every((c) => c.state === 'done')).toBe(true)
  })

  // 지난번 실행이 남긴 상태를 되살리면 안 된다.
  it('세션 시작 시각보다 오래된 파일은 무시한다', async () => {
    await writeStatus('node123', { hook_event_name: 'Stop' })
    const old = new Date(Date.now() - 120_000)
    await utimes(join(dir, 'node123.json'), old, old)

    await start(['node123'], new Date(Date.now() - 60_000))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(seen).toEqual([])
  })

  it('워크스페이스에 없는 노드의 파일은 무시한다', async () => {
    await start(['known12345'])
    await writeStatus('unknown123', { hook_event_name: 'Stop' })

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(seen).toEqual([])
  })

  it('SessionStart의 session_id를 함께 넘긴다', async () => {
    await start(['node123'])
    await writeStatus('node123', { hook_event_name: 'SessionStart', session_id: 'sess-1' })

    await waitFor(() => seen.length > 0, 'SessionStart')
    expect(seen.every((c) => c.claudeSessionId === 'sess-1')).toBe(true)
  })

  it('모르는 이벤트와 깨진 JSON은 알리지 않는다', async () => {
    await start(['node123'])
    await writeStatus('node123', { hook_event_name: 'PreCompact' })
    await writeFile(join(dir, 'node123.json'), '{깨짐', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(seen).toEqual([])
  })

  it('빠르게 여러 번 바뀌어도 마지막 상태로 수렴한다 (디바운스)', async () => {
    await start(['node123'])
    await writeStatus('node123', { hook_event_name: 'UserPromptSubmit' })
    await writeStatus('node123', { hook_event_name: 'PreToolUse' })
    await writeStatus('node123', { hook_event_name: 'Stop' })

    await waitFor(() => seen.some((c) => c.state === 'done'), '마지막 상태')
    expect(seen.at(-1)?.state).toBe('done')
  })

  // 처음 켠 사람은 이 디렉터리가 없다. 만들지 않고 watch하면 던지고, 그 뒤
  // 훅이 디렉터리를 만들어도 영영 눈치채지 못한다.
  it('디렉터리가 없으면 직접 만들고 그 뒤 변화를 잡는다', async () => {
    const fresh = join(dir, 'not-yet')
    watcher = new StatusWatcher(fresh, (change) => seen.push(change))
    watcher.setKnownNodes(['node123'])
    await watcher.start(new Date(Date.now() - 60_000))

    const temp = join(fresh, '.tmp.node123')
    await writeFile(temp, JSON.stringify({ hook_event_name: 'Stop' }), 'utf8')
    await rename(temp, join(fresh, 'node123.json'))

    await waitFor(() => seen.length > 0, '새로 만든 디렉터리의 변화')
    expect(seen.at(-1)?.state).toBe('done')
  })
})
