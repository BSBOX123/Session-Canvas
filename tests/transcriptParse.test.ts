import { describe, expect, it } from 'vitest'
import { parseLine } from '../src/main/transcript/parse'

/**
 * SPEC 16 — 실측한 모양(2026-09-25 / 2.1.280)으로 고정한다.
 * 각 줄은 실제 transcript에서 가져온 구조다.
 */
describe('parseLine — 실측한 종류', () => {
  it('last-prompt → 시킨 것', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'last-prompt',
        lastPrompt: '단계 8 진행해',
        leafUuid: '07f2e898',
        sessionId: 'c8401ab4',
        timestamp: '2026-09-25T05:54:12.019Z'
      })
    )
    expect(r.timeline).toEqual({
      kind: 'prompt',
      at: '2026-09-25T05:54:12.019Z',
      text: '단계 8 진행해'
    })
  })

  it('assistant의 tool_use → 한 것 (input은 그대로 넘긴다)', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-25T06:00:00.000Z',
        cwd: '/Users/me/dev/project/x',
        gitBranch: 'main',
        message: {
          content: [
            { type: 'text', text: '고치겠습니다' },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'a' } }
          ]
        }
      })
    )
    expect(r.timeline).toEqual({
      kind: 'tool',
      at: '2026-09-25T06:00:00.000Z',
      name: 'Edit',
      input: { file_path: '/a.ts', old_string: 'a' }
    })
    expect(r.cwd).toBe('/Users/me/dev/project/x')
    expect(r.gitBranch).toBe('main')
  })

  it('Bash는 명령 전문이 input에 그대로 남는다 (SPEC 16.1 R20)', () => {
    // 셸로 고친 파일은 file-history에 안 남으므로, 명령 자체가 유일한 단서다.
    const command = 'cat > package.json <<\'EOF\'\n{ "name": "x" }\nEOF'
    const r = parseLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] }
      })
    )
    expect(r.timeline?.kind).toBe('tool')
    expect((r.timeline as { input: Record<string, unknown> }).input.command).toBe(command)
  })

  it('ai-title → 제목 자동 채우기용', () => {
    const r = parseLine(
      JSON.stringify({ type: 'ai-title', aiTitle: 'Echo SC_STATUS_OK', sessionId: 'c9a901f4' })
    )
    expect(r.aiTitle).toBe('Echo SC_STATUS_OK')
  })

  it('file-history-delta → 바뀐 파일 1개', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'file-history-delta',
        trackingPath: '/Users/me/memory/a.md',
        messageId: 'd9d79167',
        snapshotMessageId: '99a4d9bd',
        backup: { backupFileName: null, version: 1 }
      })
    )
    expect(r.changedPaths).toEqual(['/Users/me/memory/a.md'])
  })

  it('file-history-snapshot → trackedFileBackups의 키가 바뀐 파일이다', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'file-history-snapshot',
        messageId: '2f500fb5',
        isSnapshotUpdate: false,
        snapshot: {
          messageId: '2f500fb5',
          timestamp: '2026-09-25T05:54:12.019Z',
          trackedFileBackups: {
            '/a.md': { backupFileName: 'f928c964@v2', version: 2 },
            '/b.ts': { backupFileName: null, version: 1 }
          }
        }
      })
    )
    expect(r.changedPaths.sort()).toEqual(['/a.md', '/b.ts'])
  })

  it('빈 trackedFileBackups는 빈 목록이다 (실제로 대부분 비어 있다)', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'file-history-snapshot',
        snapshot: { trackedFileBackups: {} }
      })
    )
    expect(r.changedPaths).toEqual([])
  })

  it('continued-in → 압축되어 이어진 세션 (사슬을 따라가야 한다)', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'continued-in',
        sessionId: 'dde55463',
        continuedInSessionId: 'a09799e3',
        timestamp: '2026-09-20T13:50:53.401Z'
      })
    )
    expect(r.continuedIn).toBe('a09799e3')
  })
})

// SPEC 16.3 / R14 — 비공식 포맷이다. 무슨 입력이 와도 던지지 않는다.
describe('parseLine — 망가진 입력에도 던지지 않는다 (R14)', () => {
  const inputs = [
    '',
    '   ',
    '{깨진 JSON',
    'null',
    '[]',
    '"문자열"',
    '42',
    '{}',
    '{"type":123}',
    '{"type":"last-prompt"}',
    '{"type":"last-prompt","lastPrompt":42}',
    '{"type":"ai-title","aiTitle":null}',
    '{"type":"assistant"}',
    '{"type":"assistant","message":42}',
    '{"type":"assistant","message":{"content":"배열 아님"}}',
    '{"type":"assistant","message":{"content":[42,null,"문자열"]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":42}]}}',
    '{"type":"file-history-delta"}',
    '{"type":"file-history-delta","trackingPath":""}',
    '{"type":"file-history-snapshot","snapshot":42}',
    '{"type":"file-history-snapshot","snapshot":{"trackedFileBackups":[]}}',
    '{"type":"continued-in"}',
    '{"type":"어느_미래_버전의_새_종류","뭔가":"값"}'
  ]

  it.each(inputs)('%s', (raw) => {
    const r = parseLine(raw)
    // 던지지 않고, 항상 같은 모양을 준다.
    expect(r.changedPaths).toBeInstanceOf(Array)
    expect(r.timeline === null || typeof r.timeline.kind === 'string').toBe(true)
  })

  it('모르는 종류는 조용히 버린다 — 앱이 죽지 않는다', () => {
    const r = parseLine('{"type":"attachment","attachment":{"type":"hook_success"}}')
    expect(r.timeline).toBeNull()
    expect(r.aiTitle).toBeNull()
    expect(r.changedPaths).toEqual([])
  })

  it('tool_use에 name이 없으면 그 블록을 건너뛰고 다음을 본다', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', input: {} },
            { type: 'tool_use', name: 'Read', input: { file_path: '/x' } }
          ]
        }
      })
    )
    expect(r.timeline).toMatchObject({ name: 'Read' })
  })
})
