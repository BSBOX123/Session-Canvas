/**
 * 작업 기록을 화면에 줄 모양으로 바꾼다 (SPEC 16 / 19 단계 8).
 * 순수 함수 — 단위 테스트 대상.
 *
 * **의도는 transcript, 결과는 git**이다 (SPEC 16.2). 여기서 둘을 합친다.
 */
import type { ChangedFileView, WorkLogEntry, WorkLogView } from '../../shared/ipc'
import type { RepoChanges } from '../git/GitService'
import { currentActivityOf, titleSuggestionOf, type WorkLog } from './workLog'

/** 타임라인 한 줄의 최대 길이. 노드 옆 패널에 들어가야 한다. */
const LINE_MAX = 100

function firstLine(text: string, max = LINE_MAX): string {
  const line =
    text
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? ''
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/**
 * 도구가 **무엇에** 썼는지 한 줄로. 도구마다 입력 모양이 달라 **있는 것부터**
 * 골라 쓴다 — 도구 이름으로 분기하면 새 도구가 생길 때마다 깨진다.
 *
 * 모르는 도구는 `null`이다 — 억지로 JSON을 늘어놓으면 읽을 수 없다.
 */
function detailOf(input: Record<string, unknown>): string | null {
  const str = (key: string): string | null =>
    typeof input[key] === 'string' && (input[key] as string).length > 0
      ? (input[key] as string)
      : null

  // 파일을 다루는 도구는 경로가 핵심이다.
  const path = str('file_path') ?? str('notebook_path')
  if (path !== null) return path

  // `description`을 명령보다 먼저 쓴다. **실측(2026-10-02)**: `Bash` 호출
  // 3,500건 전부에 `description`이 있고, 사람이 쓴 한 줄 요약이라 훨씬 읽힌다.
  // `command` 첫 줄은 heredoc(`python3 - <<'PY'`)이면 아무 정보가 없다.
  const description = str('description')
  if (description !== null) return firstLine(description)

  // 요약이 없을 때의 대체. 셸로 고친 파일은 명령에만 흔적이 있다 (R20).
  const command = str('command')
  if (command !== null) return firstLine(command)
  // 검색 계열.
  const pattern = str('pattern') ?? str('query')
  if (pattern !== null) return pattern
  return str('skill') ?? str('url')
}

function toEntries(log: WorkLog): WorkLogEntry[] {
  const prompts: WorkLogEntry[] = log.recentPrompts.map((p) => ({
    kind: 'prompt',
    at: p.at,
    text: firstLine(p.text),
    detail: null
  }))
  const tools: WorkLogEntry[] = log.recentTools.map((t) => ({
    kind: 'tool',
    at: t.at,
    text: t.name,
    detail: detailOf(t.input)
  }))

  // 시각이 있는 것끼리는 시간순(최근 먼저), 없는 것은 뒤로 보낸다.
  // `last-prompt`에는 timestamp가 없는 경우가 있다 (실측).
  return [...prompts, ...tools].sort((a, b) => {
    if (a.at === null && b.at === null) return 0
    if (a.at === null) return 1
    if (b.at === null) return -1
    return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  })
}

function toChangedFiles(changes: RepoChanges): ChangedFileView[] {
  return changes.files.map((f) => ({ path: f.path, kind: f.kind }))
}

/**
 * `log`가 `null`이면 **transcript를 못 읽은 것**이다. git 변경은 그래도 보여 준다 —
 * 기록이 없어도 무엇이 바뀌었는지는 알 수 있다 (SPEC 16.3).
 */
export function buildView(log: WorkLog | null, changes: RepoChanges): WorkLogView {
  return {
    title: log === null ? null : titleSuggestionOf(log),
    activity: log === null ? null : currentActivityOf(log),
    timeline: log === null ? [] : toEntries(log),
    toolCounts: log === null ? {} : log.toolCounts,
    changes: {
      root: changes.root,
      files: toChangedFiles(changes),
      truncated: changes.truncated
    },
    transcriptMissing: log === null
  }
}
