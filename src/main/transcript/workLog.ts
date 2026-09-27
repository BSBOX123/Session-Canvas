/**
 * transcript를 노드 하나의 "작업 기록"으로 누적한다 (SPEC 16, 19 단계 8).
 * 순수 함수 — 파일 접근이 없다. 단위 테스트 대상.
 *
 * **왜 누적기인가 (R16).** 세션 파일은 최대 7천 줄이고 노드 10개면 3만 줄이다.
 * 매번 전부 다시 읽으면 안 된다. JSONL은 **뒤에만 붙으므로**, 읽은 곳까지의
 * 결과를 들고 있다가 새로 붙은 줄만 넘겨 이어 누적한다.
 *
 * 그래서 이 파일은 "전체를 훑어 요약"이 아니라 "지금까지 결과 + 새 줄 → 새 결과"다.
 */
import { parseLine, type PromptEntry, type ToolEntry } from './parse'

/** 타임라인에 남길 최근 항목 수. 전부 들고 있으면 노드 10개에서 메모리가 샌다. */
const KEEP_PROMPTS = 20
const KEEP_TOOLS = 40
/** 노드 제목으로 쓸 최대 길이 (SPEC 19 단계 8). */
const TITLE_MAX = 60
/** 헤더의 "지금" 줄 최대 길이. 제목보다 길어도 된다 — 한 줄로 자른다. */
const ACTIVITY_MAX = 80

export interface WorkLog {
  /** 처리한 줄 수. 증분 읽기가 이어 붙는지 확인하는 데 쓴다. */
  lines: number
  /**
   * 세션 **시작 시점**의 주제. 세션 내내 바뀌지 않으므로 제목으로 쓰지 않는다
   * (SPEC 16.1 실측). 타임라인 머리글에만 쓴다.
   */
  aiTitle: string | null
  /** 최근이 앞. */
  recentPrompts: PromptEntry[]
  /** 최근이 앞. */
  recentTools: ToolEntry[]
  /** 도구별 호출 횟수. 전체 기간 누적이다. */
  toolCounts: Record<string, number>
  /**
   * transcript가 아는 바뀐 파일. **불완전하다** — 셸로 고친 파일은 없다
   * (SPEC 16.1 R20). 진짜 목록은 git에서 얻는다.
   */
  changedPaths: string[]
  cwd: string | null
  gitBranch: string | null
  /** 압축되어 이어진 세션 id들. 사슬을 따라가야 기록이 끊기지 않는다. */
  continuedIn: string[]
}

export function emptyWorkLog(): WorkLog {
  return {
    lines: 0,
    aiTitle: null,
    recentPrompts: [],
    recentTools: [],
    toolCounts: {},
    changedPaths: [],
    cwd: null,
    gitBranch: null,
    continuedIn: []
  }
}

/** 첫 비어 있지 않은 줄만 쓰고 자른다. 프롬프트는 붙여넣은 자료 수천 자일 수 있다. */
function firstLine(text: string, max: number): string | null {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (line === undefined) return null
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/**
 * 노드 제목 후보 (SPEC 19 단계 8).
 *
 * **`ai-title`을 쓴다.** 최근 프롬프트로 하려다 실측에서 뒤집었다 — 실제 최근
 * 프롬프트는 "커밋해", "머지해", "진행해"처럼 내용이 없는 경우가 많았고, 길이
 * 기준을 올려도 더 오래된 무의미한 프롬프트를 고를 뿐이었다. 세션 7개 중 6개에서
 * `ai-title`이 더 나은 주제 label이었다 (SPEC 16.1).
 *
 * `ai-title`은 세션 시작 시점에 고정되어 긴 세션에서 낡는다. 그 약점은 제목이
 * 아니라 `currentActivityOf`가 메운다.
 *
 * **사용자가 직접 쓴 제목은 덮지 않는다** — 부르는 쪽에서 빈 제목일 때만 쓴다.
 */
export function titleSuggestionOf(log: WorkLog): string | null {
  if (log.aiTitle === null) return null
  return firstLine(log.aiTitle, TITLE_MAX)
}

/**
 * "지금 무엇을 하는 중인가" 한 줄 (SPEC 19 단계 8).
 *
 * 가장 최근 프롬프트다. 제목이 낡아도 이 줄이 현재 상황을 알려 준다.
 */
export function currentActivityOf(log: WorkLog): string | null {
  const prompt = log.recentPrompts[0]
  if (prompt === undefined) return null
  return firstLine(prompt.text, ACTIVITY_MAX)
}

/**
 * 지금까지의 결과에 새 줄들을 이어 누적한다.
 *
 * `previous`를 주지 않으면 처음부터 읽는 것과 같다. 원본을 고치지 않는다 —
 * 부르는 쪽이 이전 결과를 계속 들고 있어도 안전해야 한다.
 */
export function accumulate(lines: Iterable<string>, previous = emptyWorkLog()): WorkLog {
  const next: WorkLog = {
    ...previous,
    recentPrompts: [...previous.recentPrompts],
    recentTools: [...previous.recentTools],
    toolCounts: { ...previous.toolCounts },
    changedPaths: [...previous.changedPaths],
    continuedIn: [...previous.continuedIn]
  }
  // 경로·세션 id는 중복이 많다. 매 줄 배열을 훑지 않는다.
  const seenPaths = new Set(next.changedPaths)
  const seenChains = new Set(next.continuedIn)

  for (const raw of lines) {
    next.lines += 1
    const parsed = parseLine(raw)

    if (parsed.cwd !== null) next.cwd = parsed.cwd
    if (parsed.gitBranch !== null) next.gitBranch = parsed.gitBranch
    // 처음 본 것을 쓴다 — 세션 시작 시 주제라는 뜻을 지킨다.
    if (parsed.aiTitle !== null && next.aiTitle === null) next.aiTitle = parsed.aiTitle

    if (parsed.timeline?.kind === 'prompt') {
      // `last-prompt`는 턴마다 다시 기록되므로 같은 프롬프트가 연달아 온다 (실측).
      // 그대로 쌓으면 타임라인이 같은 줄로 가득 찬다.
      if (next.recentPrompts[0]?.text === parsed.timeline.text) continue
      next.recentPrompts.unshift(parsed.timeline)
      if (next.recentPrompts.length > KEEP_PROMPTS) next.recentPrompts.length = KEEP_PROMPTS
    } else if (parsed.timeline?.kind === 'tool') {
      next.recentTools.unshift(parsed.timeline)
      if (next.recentTools.length > KEEP_TOOLS) next.recentTools.length = KEEP_TOOLS
      const name = parsed.timeline.name
      next.toolCounts[name] = (next.toolCounts[name] ?? 0) + 1
    }

    for (const path of parsed.changedPaths) {
      if (seenPaths.has(path)) continue
      seenPaths.add(path)
      next.changedPaths.push(path)
    }
    if (parsed.continuedIn !== null && !seenChains.has(parsed.continuedIn)) {
      seenChains.add(parsed.continuedIn)
      next.continuedIn.push(parsed.continuedIn)
    }
  }
  return next
}
