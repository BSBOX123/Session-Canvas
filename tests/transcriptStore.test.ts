import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { TranscriptStore } from '../src/main/transcript/TranscriptStore'

let projects = ''
let store: TranscriptStore

beforeEach(async () => {
  projects = await mkdtemp(join(tmpdir(), 'session-canvas-transcripts-'))
  store = new TranscriptStore(projects)
})

const prompt = (text: string): string =>
  `${JSON.stringify({ type: 'last-prompt', lastPrompt: text })}\n`
const tool = (name: string): string =>
  `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } })}\n`

async function writeSession(folder: string, id: string, body: string): Promise<string> {
  const dir = join(projects, folder)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${id}.jsonl`)
  await writeFile(path, body, 'utf8')
  return path
}

describe('TranscriptStore.locate', () => {
  it('session id로 폴더를 훑어 찾는다 (경로를 계산하지 않는다)', async () => {
    await writeSession('-Users-me-dev-x', 'sess-1', prompt('안녕'))
    expect(await store.locate('sess-1')).toBe(join(projects, '-Users-me-dev-x', 'sess-1.jsonl'))
  })

  it('없으면 null', async () => {
    expect(await store.locate('sess-없음')).toBeNull()
  })

  it('projects 폴더가 아예 없어도 던지지 않는다', async () => {
    const missing = new TranscriptStore(join(projects, '아직-없음'))
    expect(await missing.locate('sess-1')).toBeNull()
  })

  // 실측: 프로젝트를 옮기면 같은 id가 두 폴더에 생긴다 (27줄 껍데기 + 7227줄 본체).
  it('같은 id가 두 폴더에 있으면 가장 최근에 수정된 것을 쓴다', async () => {
    const stale = await writeSession('-Users-me-Desktop-old', 'sess-1', prompt('껍데기'))
    const live = await writeSession('-Users-me-dev-new', 'sess-1', prompt('본체'))
    const old = new Date(Date.now() - 60_000)
    await utimes(stale, old, old)

    expect(await store.locate('sess-1')).toBe(live)
    const log = await store.read('sess-1')
    expect(log?.recentPrompts[0]?.text).toBe('본체')
  })
})

describe('TranscriptStore.read — 증분 (R16)', () => {
  it('처음 읽으면 전부 읽는다', async () => {
    await writeSession('p', 'sess-1', prompt('하나') + tool('Bash'))
    const log = await store.read('sess-1')
    expect(log?.lines).toBe(2)
    expect(log?.toolCounts).toEqual({ Bash: 1 })
  })

  it('뒤에 붙은 줄만 이어 읽는다', async () => {
    const path = await writeSession('p', 'sess-1', prompt('하나'))
    const first = await store.read('sess-1')
    expect(first?.lines).toBe(1)

    await appendFile(path, tool('Bash') + prompt('둘'), 'utf8')
    const second = await store.read('sess-1')
    expect(second?.lines).toBe(3)
    expect(second?.recentPrompts.map((p) => p.text)).toEqual(['둘', '하나'])
  })

  it('바뀐 게 없으면 결과가 그대로다', async () => {
    await writeSession('p', 'sess-1', prompt('하나'))
    const first = await store.read('sess-1')
    const second = await store.read('sess-1')
    expect(second).toEqual(first)
  })

  it('줄 중간까지만 쓰인 상태면 그 줄은 다음에 읽는다', async () => {
    const path = await writeSession('p', 'sess-1', prompt('완성된 줄'))
    await store.read('sess-1')

    // 줄바꿈 없이 반만 쓴다 (훅이 쓰는 도중일 수 있다).
    await appendFile(path, '{"type":"last-prompt","lastPromp', 'utf8')
    const mid = await store.read('sess-1')
    expect(mid?.lines).toBe(1)
    expect(mid?.recentPrompts.map((p) => p.text)).toEqual(['완성된 줄'])

    // 나머지가 붙으면 그때 읽힌다.
    await appendFile(path, 't":"나중 줄"}\n', 'utf8')
    const done = await store.read('sess-1')
    expect(done?.recentPrompts.map((p) => p.text)).toEqual(['나중 줄', '완성된 줄'])
  })

  it('한글이 읽는 경계에 걸려도 깨지지 않는다', async () => {
    // `\n`은 다중바이트 문자의 일부가 될 수 없으므로 바이트에서 잘라도 안전하다.
    const path = await writeSession('p', 'sess-1', prompt('가나다라마바사'))
    await store.read('sess-1')
    await appendFile(path, prompt('한글 이어 쓰기 테스트'), 'utf8')
    const log = await store.read('sess-1')
    expect(log?.recentPrompts[0]?.text).toBe('한글 이어 쓰기 테스트')
  })

  it('파일이 줄어들면 처음부터 다시 읽는다 (압축·회전)', async () => {
    const path = await writeSession('p', 'sess-1', prompt('하나') + prompt('둘') + prompt('셋'))
    const first = await store.read('sess-1')
    expect(first?.lines).toBe(3)

    await writeFile(path, prompt('새로 시작'), 'utf8')
    const second = await store.read('sess-1')
    expect(second?.lines).toBe(1)
    expect(second?.recentPrompts.map((p) => p.text)).toEqual(['새로 시작'])
  })

  it('파일이 사라지면 null', async () => {
    const path = await writeSession('p', 'sess-1', prompt('하나'))
    expect(await store.read('sess-1')).not.toBeNull()
    await rm(path)
    expect(await store.read('sess-1')).toBeNull()
  })

  it('없는 세션은 null — 기록 없이 동작해야 한다 (R14)', async () => {
    expect(await store.read('sess-없음')).toBeNull()
  })
})

// SPEC 16.1 — 훅이 알려 준 경로를 쓴다. 두 에이전트의 경로 구조가 다르기 때문이다.
describe('TranscriptStore.read — 알려진 경로 우선', () => {
  it('훅이 준 경로를 쓰면 찾기를 건너뛴다', async () => {
    // Codex 구조를 흉내 낸다. `locate()`는 이 구조를 못 찾는다.
    const dir = join(projects, '..', 'codex-sessions', '2026', '10', '02')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'rollout-2026-10-02T00-00-00-sess-codex.jsonl')
    await writeFile(path, prompt('코덱스 작업'), 'utf8')

    // 찾기로는 못 찾는다.
    expect(await store.locate('sess-codex')).toBeNull()
    // 경로를 주면 읽힌다.
    const log = await store.read('sess-codex', path)
    expect(log?.recentPrompts[0]?.text).toBe('코덱스 작업')
  })

  it('경로를 주지 않으면 찾기로 떨어진다 (Claude Code 구조)', async () => {
    await writeSession('-Users-me-dev-x', 'sess-claude', prompt('클로드 작업'))
    const log = await store.read('sess-claude')
    expect(log?.recentPrompts[0]?.text).toBe('클로드 작업')
  })

  it('준 경로가 없는 파일이면 null — 던지지 않는다', async () => {
    expect(await store.read('sess-x', join(projects, '없는파일.jsonl'))).toBeNull()
  })
})

// SPEC 16.1 — 압축되면 새 id로 이어진다. 따라가지 않으면 최근 작업이 통째로 빠진다.
describe('TranscriptStore.read — continued-in 사슬', () => {
  const chain = (to: string): string =>
    `${JSON.stringify({ type: 'continued-in', continuedInSessionId: to })}\n`

  it('이어진 세션까지 한 기록으로 합친다', async () => {
    await writeSession('p', 'a', prompt('옛 작업') + tool('Bash') + chain('b'))
    await writeSession('p', 'b', prompt('최근 작업') + tool('Read'))

    const log = await store.read('a')
    expect(log?.recentPrompts.map((p) => p.text)).toEqual(['최근 작업', '옛 작업'])
    expect(log?.toolCounts).toEqual({ Bash: 1, Read: 1 })
  })

  it('이어진 세션이 아직 없으면 있는 것만 준다', async () => {
    await writeSession('p', 'a', prompt('옛 작업') + chain('없는-세션'))
    const log = await store.read('a')
    expect(log?.recentPrompts.map((p) => p.text)).toEqual(['옛 작업'])
  })

  it('aiTitle은 첫 세션의 것을 유지한다 (세션 시작 시 주제)', async () => {
    await writeSession(
      'p',
      'a',
      `${JSON.stringify({ type: 'ai-title', aiTitle: '처음 주제' })}\n` + chain('b')
    )
    await writeSession('p', 'b', `${JSON.stringify({ type: 'ai-title', aiTitle: '나중 주제' })}\n`)
    expect((await store.read('a'))?.aiTitle).toBe('처음 주제')
  })

  it('사슬이 고리를 이뤄도 멈춘다', async () => {
    await writeSession('p', 'a', prompt('가') + chain('b'))
    await writeSession('p', 'b', prompt('나') + chain('a'))
    const log = await store.read('a')
    expect(log?.recentPrompts.map((p) => p.text)).toEqual(['나', '가'])
  })

  it('사슬이 길어도 멈춘다', async () => {
    for (let i = 0; i < 20; i += 1) {
      await writeSession('p', `s${i}`, prompt(`p${i}`) + chain(`s${i + 1}`))
    }
    const log = await store.read('s0')
    expect(log).not.toBeNull()
    // MAX_CHAIN=8 을 넘지 않는다.
    expect(log!.recentPrompts.length).toBeLessThanOrEqual(8)
  })
})
