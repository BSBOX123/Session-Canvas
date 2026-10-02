import { describe, expect, it } from 'vitest'
import { buildView } from '../src/main/transcript/buildView'
import { accumulate, emptyWorkLog } from '../src/main/transcript/workLog'
import type { RepoChanges } from '../src/main/git/GitService'

const prompt = (text: string, at?: string): string =>
  JSON.stringify({ type: 'last-prompt', lastPrompt: text, timestamp: at })
const tool = (name: string, input: Record<string, unknown>, at?: string): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { content: [{ type: 'tool_use', name, input }] }
  })
const noRepo: RepoChanges = { root: null, files: [], truncated: false }

describe('buildView (SPEC 16 / 19 단계 8)', () => {
  it('제목은 ai-title, 지금은 최근 프롬프트다', () => {
    const log = accumulate([
      JSON.stringify({ type: 'ai-title', aiTitle: '주제' }),
      prompt('지금 하는 일')
    ])
    const view = buildView(log, noRepo)
    expect(view.title).toBe('주제')
    expect(view.activity).toBe('지금 하는 일')
  })

  it('transcript를 못 읽으면 표시하고, git 변경은 그래도 준다 (SPEC 16.3)', () => {
    // 기록이 **없는 것**과 **못 읽은 것**은 다르다.
    const view = buildView(null, {
      root: '/repo',
      files: [{ path: 'a.ts', kind: 'modified' }],
      truncated: false
    })
    expect(view.transcriptMissing).toBe(true)
    expect(view.timeline).toEqual([])
    expect(view.changes.files).toEqual([{ path: 'a.ts', kind: 'modified' }])
  })

  it('기록이 비어 있는 것은 못 읽은 것과 다르다', () => {
    expect(buildView(emptyWorkLog(), noRepo).transcriptMissing).toBe(false)
  })

  it('저장소가 아니면 root가 null로 넘어간다', () => {
    expect(buildView(emptyWorkLog(), noRepo).changes.root).toBeNull()
  })

  describe('타임라인', () => {
    it('프롬프트와 도구가 시간순으로 섞인다 (최근 먼저)', () => {
      const log = accumulate([
        prompt('첫 지시', '2026-10-02T00:00:01Z'),
        tool('Bash', { description: '첫 작업' }, '2026-10-02T00:00:02Z'),
        prompt('둘째 지시', '2026-10-02T00:00:03Z')
      ])
      expect(buildView(log, noRepo).timeline.map((e) => e.text)).toEqual([
        '둘째 지시',
        'Bash',
        '첫 지시'
      ])
    })

    it('시각이 없는 항목은 뒤로 보낸다 (last-prompt에 timestamp가 없을 수 있다)', () => {
      const log = accumulate([
        prompt('시각 없음'),
        tool('Read', { file_path: '/a.ts' }, '2026-10-02T00:00:05Z')
      ])
      const kinds = buildView(log, noRepo).timeline.map((e) => e.at === null)
      expect(kinds).toEqual([false, true])
    })

    it('프롬프트는 첫 줄만, 긴 줄은 자른다', () => {
      const log = accumulate([prompt(`${'가'.repeat(200)}\n둘째 줄`)])
      const [entry] = buildView(log, noRepo).timeline
      expect(entry.text.length).toBe(100)
      expect(entry.text.endsWith('…')).toBe(true)
    })
  })

  describe('도구 요약 (detail)', () => {
    const detailOf = (name: string, input: Record<string, unknown>): string | null =>
      buildView(accumulate([tool(name, input)]), noRepo).timeline[0]?.detail ?? null

    it('파일 도구는 경로를 쓴다', () => {
      expect(detailOf('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts')
      expect(detailOf('Edit', { file_path: '/a/b.ts', old_string: 'x' })).toBe('/a/b.ts')
    })

    /**
     * 실측: `Bash` 호출 3,500건 전부에 `description`이 있다. heredoc 명령의
     * 첫 줄(`python3 - <<'PY'`)은 아무 정보가 없어서 요약이 훨씬 낫다.
     */
    it('Bash는 명령보다 description을 쓴다', () => {
      expect(
        detailOf('Bash', { command: "python3 - <<'PY'\nprint(1)\nPY", description: '설정 갱신' })
      ).toBe('설정 갱신')
    })

    it('description이 없으면 명령 첫 줄로 떨어진다 (셸 변경의 유일한 흔적, R20)', () => {
      expect(detailOf('Bash', { command: 'rm -rf build\necho done' })).toBe('rm -rf build')
    })

    it('검색 계열은 패턴을 쓴다', () => {
      expect(detailOf('Grep', { pattern: 'TODO' })).toBe('TODO')
      expect(detailOf('WebSearch', { query: 'tmux' })).toBe('tmux')
    })

    it('모르는 도구는 null — 억지로 JSON을 늘어놓지 않는다', () => {
      expect(detailOf('어떤_새_도구', { 뭔가: { 깊은: '구조' } })).toBeNull()
      expect(detailOf('TaskStop', {})).toBeNull()
    })

    it('프롬프트에는 detail이 없다', () => {
      const view = buildView(accumulate([prompt('지시')]), noRepo)
      expect(view.timeline[0].detail).toBeNull()
    })
  })

  it('도구 횟수는 그대로 넘어간다 (배지에 쓴다)', () => {
    const log = accumulate([
      tool('Bash', { description: 'a' }),
      tool('Bash', { description: 'b' }),
      tool('Read', { file_path: '/x' })
    ])
    expect(buildView(log, noRepo).toolCounts).toEqual({ Bash: 2, Read: 1 })
  })
})
