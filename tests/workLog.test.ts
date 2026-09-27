import { describe, expect, it } from 'vitest'
import {
  accumulate,
  currentActivityOf,
  emptyWorkLog,
  titleSuggestionOf
} from '../src/main/transcript/workLog'

const prompt = (text: string, at?: string): string =>
  JSON.stringify({ type: 'last-prompt', lastPrompt: text, timestamp: at })
const tool = (name: string, input: Record<string, unknown> = {}, extra = {}): string =>
  JSON.stringify({
    type: 'assistant',
    ...extra,
    message: { content: [{ type: 'tool_use', name, input }] }
  })

describe('accumulate (SPEC 16)', () => {
  it('프롬프트와 도구를 최근 순으로 쌓는다', () => {
    const log = accumulate([prompt('첫째'), tool('Bash'), prompt('둘째'), tool('Read')])
    expect(log.lines).toBe(4)
    expect(log.recentPrompts.map((p) => p.text)).toEqual(['둘째', '첫째'])
    expect(log.recentTools.map((t) => t.name)).toEqual(['Read', 'Bash'])
    expect(log.toolCounts).toEqual({ Bash: 1, Read: 1 })
  })

  it('연달아 온 같은 프롬프트는 한 번만 쌓는다 (last-prompt는 턴마다 다시 기록된다)', () => {
    const log = accumulate([
      prompt('같은 것'),
      prompt('같은 것'),
      prompt('다른 것'),
      prompt('같은 것')
    ])
    expect(log.recentPrompts.map((p) => p.text)).toEqual(['같은 것', '다른 것', '같은 것'])
    // 줄 수는 그대로 센다 — 증분 읽기가 이어지는 기준이다.
    expect(log.lines).toBe(4)
  })

  it('바뀐 파일은 중복을 없애 순서대로 모은다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'file-history-delta', trackingPath: '/a.ts' }),
      JSON.stringify({ type: 'file-history-delta', trackingPath: '/a.ts' }),
      JSON.stringify({
        type: 'file-history-snapshot',
        snapshot: { trackedFileBackups: { '/a.ts': {}, '/b.ts': {} } }
      })
    ])
    expect(log.changedPaths).toEqual(['/a.ts', '/b.ts'])
  })

  it('cwd·gitBranch는 마지막 값을 쓴다 (브랜치를 바꿀 수 있다)', () => {
    const log = accumulate([
      tool('Bash', {}, { cwd: '/x', gitBranch: 'main' }),
      tool('Bash', {}, { cwd: '/x', gitBranch: 'feature/b' })
    ])
    expect(log.gitBranch).toBe('feature/b')
    expect(log.cwd).toBe('/x')
  })

  it('ai-title은 처음 본 것을 쓴다 — 세션 시작 시 주제라는 뜻이다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'ai-title', aiTitle: '처음 주제' }),
      JSON.stringify({ type: 'ai-title', aiTitle: '나중 주제' })
    ])
    expect(log.aiTitle).toBe('처음 주제')
  })

  it('continued-in 사슬을 중복 없이 모은다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'continued-in', continuedInSessionId: 'b' }),
      JSON.stringify({ type: 'continued-in', continuedInSessionId: 'b' }),
      JSON.stringify({ type: 'continued-in', continuedInSessionId: 'c' })
    ])
    expect(log.continuedIn).toEqual(['b', 'c'])
  })

  // R16 — 증분 읽기의 핵심. 나눠 넣어도 한 번에 넣은 것과 같아야 한다.
  describe('증분 누적 (R16)', () => {
    const all = [prompt('하나'), tool('Bash'), prompt('둘'), tool('Read'), tool('Bash')]

    it('나눠 넣은 결과가 한 번에 넣은 것과 같다', () => {
      const once = accumulate(all)
      const split = accumulate(all.slice(3), accumulate(all.slice(0, 3)))
      expect(split).toEqual(once)
    })

    it('이전 결과를 고치지 않는다', () => {
      const first = accumulate([prompt('하나'), tool('Bash')])
      const snapshot = structuredClone(first)
      accumulate([prompt('둘'), tool('Read')], first)
      expect(first).toEqual(snapshot)
    })

    it('줄 수가 이어진다', () => {
      const a = accumulate(all.slice(0, 2))
      const b = accumulate(all.slice(2), a)
      expect(b.lines).toBe(all.length)
    })
  })

  it('긴 세션에서도 최근 항목만 들고 있다 (메모리)', () => {
    const many = Array.from({ length: 500 }, (_, i) => prompt(`p${i}`))
    const tools = Array.from({ length: 500 }, (_, i) => tool(`T${i % 3}`))
    const log = accumulate([...many, ...tools])
    expect(log.lines).toBe(1000)
    expect(log.recentPrompts.length).toBe(20)
    expect(log.recentTools.length).toBe(40)
    // 횟수는 잘리지 않는다 — 배지에 쓴다.
    expect(log.toolCounts.T0 + log.toolCounts.T1 + log.toolCounts.T2).toBe(500)
  })

  it('망가진 줄이 섞여 있어도 나머지를 누적한다 (R14)', () => {
    const log = accumulate(['{깨짐', '', 'null', prompt('살아있다'), '{"type":"미래종류"}'])
    expect(log.lines).toBe(5)
    expect(log.recentPrompts.map((p) => p.text)).toEqual(['살아있다'])
  })

  it('빈 결과는 빈 모양이다', () => {
    expect(accumulate([])).toEqual(emptyWorkLog())
  })
})

// SPEC 19 단계 8 — 제목은 ai-title, "지금"은 최근 프롬프트 (실측으로 뒤집은 결정).
describe('titleSuggestionOf (SPEC 19 단계 8)', () => {
  it('ai-title을 제목으로 쓴다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'ai-title', aiTitle: 'LectureMate AI 풀스택 프로젝트 구현' }),
      prompt('머지해')
    ])
    expect(titleSuggestionOf(log)).toBe('LectureMate AI 풀스택 프로젝트 구현')
  })

  it('최근 프롬프트를 제목으로 쓰지 않는다 — "커밋해" 같은 것이 대부분이다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'ai-title', aiTitle: '주제' }),
      prompt('커밋해')
    ])
    expect(titleSuggestionOf(log)).toBe('주제')
  })

  it('긴 제목은 자른다', () => {
    const log = accumulate([JSON.stringify({ type: 'ai-title', aiTitle: '가'.repeat(200) })])
    const title = titleSuggestionOf(log)
    expect(title!.length).toBe(60)
    expect(title!.endsWith('…')).toBe(true)
  })

  it('ai-title이 없으면 null — 폴더명을 쓰던 기존 동작이 유지된다', () => {
    expect(titleSuggestionOf(emptyWorkLog())).toBeNull()
    expect(titleSuggestionOf(accumulate([prompt('무언가')]))).toBeNull()
  })
})

describe('currentActivityOf (SPEC 19 단계 8)', () => {
  it('가장 최근 프롬프트의 첫 줄을 준다', () => {
    const log = accumulate([prompt('예전 일'), prompt('지금 하는 일\n둘째 줄')])
    expect(currentActivityOf(log)).toBe('지금 하는 일')
  })

  it('앞의 빈 줄을 건너뛴다', () => {
    expect(currentActivityOf(accumulate([prompt('\n\n   \n실제 내용')]))).toBe('실제 내용')
  })

  it('붙여넣은 긴 자료는 자른다', () => {
    const activity = currentActivityOf(accumulate([prompt('가'.repeat(300))]))
    expect(activity!.length).toBe(80)
    expect(activity!.endsWith('…')).toBe(true)
  })

  it('프롬프트가 없으면 null', () => {
    expect(currentActivityOf(emptyWorkLog())).toBeNull()
    expect(currentActivityOf(accumulate([prompt('   \n  ')]))).toBeNull()
  })

  it('제목이 낡아도 이 줄은 현재를 가리킨다 (ai-title 약점 보완)', () => {
    const log = accumulate([
      JSON.stringify({ type: 'ai-title', aiTitle: 'Session Canvas stage 0 scaffold' }),
      prompt('단계 8 진행해')
    ])
    expect(titleSuggestionOf(log)).toBe('Session Canvas stage 0 scaffold')
    expect(currentActivityOf(log)).toBe('단계 8 진행해')
  })
})
