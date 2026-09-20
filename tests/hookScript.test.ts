import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const SCRIPT = resolve(__dirname, '../resources/hooks/session-canvas-hook.sh')

let home = ''

beforeEach(async () => {
  // ⚠️ 절대 진짜 HOME으로 돌리지 않는다 (SPEC 0.4 / 14.2).
  home = await mkdtemp(join(tmpdir(), 'session-canvas-hook-'))
})

/** 훅을 한 번 실행한다. stdin으로 JSON을 넣고 stdout/exit을 돌려준다. */
async function runHook(
  payload: string,
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = execFileAsync(SCRIPT, [], {
    env: { HOME: home, PATH: process.env.PATH ?? '', ...env }
  })
  child.child.stdin?.end(payload)
  try {
    const { stdout, stderr } = await child
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number }
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 }
  }
}

const statusDir = (): string => join(home, '.session-canvas', 'status')

// SPEC 8.3 / 14.2
describe('session-canvas-hook.sh', () => {
  it('노드 id가 있으면 stdin을 그대로 상태 파일에 쓴다', async () => {
    const payload = '{"hook_event_name":"Stop","session_id":"abc"}'
    const result = await runHook(payload, { SESSION_CANVAS_NODE_ID: 'node123' })

    expect(result.code).toBe(0)
    expect(await readFile(join(statusDir(), 'node123.json'), 'utf8')).toBe(payload)
  })

  it('Claude Code 동작에 영향을 주지 않는다 — 항상 exit 0, stdout 없음', async () => {
    const result = await runHook('{"hook_event_name":"Stop"}', {
      SESSION_CANVAS_NODE_ID: 'node123'
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
  })

  // 앱 밖에서 실행된 Claude Code에서는 아무것도 하지 않아야 한다.
  it('SESSION_CANVAS_NODE_ID가 없으면 파일을 만들지 않는다', async () => {
    const result = await runHook('{"hook_event_name":"Stop"}')
    expect(result.code).toBe(0)
    await expect(stat(statusDir())).rejects.toThrow()
  })

  it('빈 노드 id도 무시한다', async () => {
    await runHook('{"hook_event_name":"Stop"}', { SESSION_CANVAS_NODE_ID: '' })
    await expect(stat(statusDir())).rejects.toThrow()
  })

  // 경로 조작 방지 (SPEC 8.3)
  it.each(['../../etc/passwd', 'a/b', 'has space', 'x;rm -rf /', '.'])(
    '잘못된 id(%s)는 거부한다',
    async (id) => {
      const result = await runHook('{"hook_event_name":"Stop"}', { SESSION_CANVAS_NODE_ID: id })
      expect(result.code).toBe(0)
      await expect(stat(statusDir())).rejects.toThrow()
    }
  )

  it('여러 번 실행하면 최신 이벤트로 덮어쓰고 임시 파일을 남기지 않는다', async () => {
    const env = { SESSION_CANVAS_NODE_ID: 'node123' }
    await runHook('{"hook_event_name":"UserPromptSubmit"}', env)
    await runHook('{"hook_event_name":"Stop"}', env)

    expect(await readFile(join(statusDir(), 'node123.json'), 'utf8')).toBe(
      '{"hook_event_name":"Stop"}'
    )
    expect(await readdir(statusDir())).toEqual(['node123.json'])
  })
})
