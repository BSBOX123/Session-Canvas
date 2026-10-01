/**
 * transcript 파일을 찾아 **증분으로** 읽는다 (SPEC 16, R16).
 *
 * 경로 규칙을 계산하지 않는다. `~/.claude/projects/<슬러그>/<session_id>.jsonl`의
 * 슬러그는 `cwd`의 비영숫자를 `-`로 바꾼 것으로 **보이지만**(실측 35개 중 32개 일치),
 * 폴더는 **세션이 시작된 위치**로 정해지고 `cwd`는 그 뒤 바뀔 수 있다. 실제로 폴더와
 * `cwd`가 서로 뒤바뀐 경우를 3건 관측했다(프로젝트를 옮긴 세션, 임시 폴더에서 시작한
 * 세션). 그래서 **session id로 폴더 전체를 훑어 찾는다** — 35개 폴더 훑기에 0.7ms다.
 *
 * 같은 id가 두 폴더에 있는 경우도 1건 관측했다(옮기기 전 27줄 껍데기 + 옮긴 뒤 7227줄
 * 본체). **가장 최근에 수정된 것**을 쓴다.
 */
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { accumulate, emptyWorkLog, type WorkLog } from './workLog'

/** `continued-in` 사슬을 따라갈 최대 깊이. 고리가 생겨도 멈춘다. */
const MAX_CHAIN = 8

interface Cursor {
  path: string
  /** 소비한 **마지막 완전한 줄** 다음 바이트. 여기서부터 이어 읽는다. */
  offset: number
  log: WorkLog
}

export class TranscriptStore {
  /** session id → 이어 읽는 자리. */
  private readonly cursors = new Map<string, Cursor>()

  constructor(private readonly projectsDir: string) {}

  /**
   * session id로 파일을 찾는다. 없으면 `null`.
   *
   * 매번 훑는다 — 0.7ms이고, 캐시하면 파일이 옮겨졌을 때 조용히 틀린 것을 읽는다.
   */
  async locate(sessionId: string): Promise<string | null> {
    const name = `${sessionId}.jsonl`
    let folders: string[]
    try {
      folders = (await readdir(this.projectsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      // `~/.claude/projects`가 아직 없을 수 있다. 기록이 없는 것과 같다.
      return null
    }

    let best: { path: string; mtimeMs: number } | null = null
    for (const folder of folders) {
      const path = join(this.projectsDir, folder, name)
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        // 같은 id가 여러 폴더에 있으면 가장 최근에 쓰인 것이 본체다 (실측).
        if (best === null || info.mtimeMs > best.mtimeMs) best = { path, mtimeMs: info.mtimeMs }
      } catch {
        // 그 폴더에는 없다.
      }
    }
    return best?.path ?? null
  }

  /**
   * 지난번 읽은 곳부터 이어 읽어 작업 기록을 준다. 파일이 없으면 `null`.
   *
   * `continued-in`을 따라가 이어진 세션까지 한 기록으로 합친다 — 압축되면 새 id로
   * 넘어가므로, 따라가지 않으면 최근 작업이 통째로 빠진다.
   */
  async read(sessionId: string): Promise<WorkLog | null> {
    let log: WorkLog | null = null
    let current: string | undefined = sessionId
    const visited = new Set<string>()

    for (let depth = 0; depth < MAX_CHAIN && current !== undefined; depth += 1) {
      if (visited.has(current)) break
      visited.add(current)

      const one = await this.readOne(current)
      if (one !== null) log = log === null ? one : mergeChain(log, one)
      // 이어진 곳은 방금 읽은 세션이 알려 준다.
      current = one?.continuedIn.find((id) => !visited.has(id))
    }
    return log
  }

  /** 세션 하나만 증분으로 읽는다. */
  private async readOne(sessionId: string): Promise<WorkLog | null> {
    const path = await this.locate(sessionId)
    if (path === null) {
      this.cursors.delete(sessionId)
      return null
    }

    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return null
    }

    const previous = this.cursors.get(sessionId)
    // 경로가 바뀌었거나 파일이 줄었으면(압축·회전) 처음부터 다시 읽는다.
    const reuse = previous !== undefined && previous.path === path && size >= previous.offset
    const cursor: Cursor = reuse ? previous : { path, offset: 0, log: emptyWorkLog() }

    if (size > cursor.offset) {
      const chunk = await readRange(path, cursor.offset, size)
      if (chunk === null) return cursor.log
      // 줄 중간까지만 쓰인 상태일 수 있다. **마지막 줄바꿈까지만** 소비한다.
      // UTF-8에서 `\n`(0x0A)은 다중바이트 문자의 일부가 될 수 없으므로
      // 바이트에서 찾아도 안전하다.
      const end = chunk.lastIndexOf(0x0a)
      if (end >= 0) {
        const text = chunk.subarray(0, end).toString('utf8')
        cursor.log = accumulate(text.split('\n'), cursor.log)
        cursor.offset += end + 1
      }
    }

    this.cursors.set(sessionId, cursor)
    return cursor.log
  }

  /** 점검·테스트용. 다음 읽기가 처음부터 하게 만든다. */
  reset(): void {
    this.cursors.clear()
  }
}

/**
 * 이어진 세션의 기록을 앞 기록에 붙인다.
 *
 * `later`가 더 나중이므로 최근 항목·제목은 `later`가 이긴다. 다만 `aiTitle`은
 * **처음 세션의 것**을 유지한다 — 세션 시작 시 주제라는 뜻을 지킨다 (SPEC 16.1).
 */
function mergeChain(earlier: WorkLog, later: WorkLog): WorkLog {
  const counts: Record<string, number> = { ...earlier.toolCounts }
  for (const [name, n] of Object.entries(later.toolCounts)) {
    counts[name] = (counts[name] ?? 0) + n
  }
  return {
    lines: earlier.lines + later.lines,
    aiTitle: earlier.aiTitle ?? later.aiTitle,
    recentPrompts: [...later.recentPrompts, ...earlier.recentPrompts].slice(0, 20),
    recentTools: [...later.recentTools, ...earlier.recentTools].slice(0, 40),
    toolCounts: counts,
    changedPaths: [...new Set([...earlier.changedPaths, ...later.changedPaths])],
    cwd: later.cwd ?? earlier.cwd,
    gitBranch: later.gitBranch ?? earlier.gitBranch,
    continuedIn: [...new Set([...earlier.continuedIn, ...later.continuedIn])]
  }
}

/** `[from, to)` 바이트만 읽는다. 전체를 읽으면 증분의 의미가 없다. */
async function readRange(path: string, from: number, to: number): Promise<Buffer | null> {
  const length = to - from
  if (length <= 0) return null
  const handle = await open(path, 'r').catch(() => null)
  if (handle === null) return null
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}
