/**
 * Claude Code transcript JSONL 파싱 (SPEC 16). 순수 함수 — 단위 테스트 대상.
 *
 * ⚠️ **문서화되지 않은 내부 포맷이다** (SPEC 16.3 / R14). 버전이 바뀌면 깨진다.
 * 그래서 이 파일의 규칙은 하나다: **모르는 것은 버리고, 절대 던지지 않는다.**
 * 읽지 못하면 그 노드의 작업 기록만 비어 보이고 터미널·tmux는 그대로 동작한다.
 *
 * 이 파일에 **쓰지 않는다.** 읽기 전용이다.
 */

/** 사람이 시킨 것 (SPEC 16.1). */
export interface PromptEntry {
  kind: 'prompt'
  at: string | null
  text: string
}

/** 에이전트가 한 것. `input`은 도구마다 달라 좁히지 않는다. */
export interface ToolEntry {
  kind: 'tool'
  at: string | null
  name: string
  input: Record<string, unknown>
}

export type TimelineEntry = PromptEntry | ToolEntry

/**
 * 한 줄을 해석한 결과. 여기 없는 종류는 `null`이다.
 *
 * `changedPaths`는 **불완전하다** — `Edit`·`Write`를 거친 변경만 남는다.
 * 셸로 고친 파일은 여기 없다 (SPEC 16.1 R20). 진짜 목록은 git에서 얻는다.
 */
export interface ParsedLine {
  timeline: TimelineEntry | null
  aiTitle: string | null
  changedPaths: string[]
  /** 세션이 압축되어 이어진 곳 (SPEC 16.1 `continued-in`). */
  continuedIn: string | null
  cwd: string | null
  gitBranch: string | null
}

const EMPTY: ParsedLine = {
  timeline: null,
  aiTitle: null,
  changedPaths: [],
  continuedIn: null,
  cwd: null,
  gitBranch: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** assistant 메시지의 `content` 배열에서 첫 `tool_use`를 꺼낸다. */
function toolUseOf(payload: Record<string, unknown>): ToolEntry | null {
  const message = payload.message
  if (!isRecord(message)) return null
  const content = message.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') continue
    const name = str(block.name)
    if (name === null) continue
    return {
      kind: 'tool',
      at: str(payload.timestamp),
      name,
      input: isRecord(block.input) ? block.input : {}
    }
  }
  return null
}

/**
 * `file-history-snapshot`은 경로 → 백업정보 **맵**이다. 키만 쓴다 (SPEC 16.2).
 */
function snapshotPaths(payload: Record<string, unknown>): string[] {
  const snapshot = payload.snapshot
  if (!isRecord(snapshot)) return []
  const tracked = snapshot.trackedFileBackups
  if (!isRecord(tracked)) return []
  return Object.keys(tracked).filter((path) => path.length > 0)
}

/**
 * JSONL 한 줄을 해석한다. 깨진 JSON·모르는 종류는 빈 결과를 준다.
 *
 * 빈 결과와 `null`을 구별하지 않는다 — 부르는 쪽이 분기하지 않아도 되게 한다.
 */
export function parseLine(raw: string): ParsedLine {
  const line = raw.trim()
  if (line.length === 0) return EMPTY

  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    return EMPTY
  }
  if (!isRecord(payload)) return EMPTY

  const cwd = str(payload.cwd)
  const gitBranch = str(payload.gitBranch)
  const base = { ...EMPTY, cwd, gitBranch }

  switch (payload.type) {
    case 'last-prompt': {
      const text = str(payload.lastPrompt)
      if (text === null) return base
      return { ...base, timeline: { kind: 'prompt', at: str(payload.timestamp), text } }
    }
    case 'assistant':
      return { ...base, timeline: toolUseOf(payload) }
    case 'ai-title':
      return { ...base, aiTitle: str(payload.aiTitle) }
    case 'file-history-delta': {
      const path = str(payload.trackingPath)
      return { ...base, changedPaths: path === null ? [] : [path] }
    }
    case 'file-history-snapshot':
      return { ...base, changedPaths: snapshotPaths(payload) }
    case 'continued-in':
      return { ...base, continuedIn: str(payload.continuedInSessionId) }
    default:
      // `attachment`·`mode`·`system` 등은 작업 기록과 무관하다 (SPEC 16.1).
      return base
  }
}
