import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { GitService, parseStatusZ } from '../src/main/git/GitService'

const execFileAsync = promisify(execFile)
const service = new GitService(process.env)

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-canvas-git-'))
})

async function initRepo(branch = 'main'): Promise<void> {
  await execFileAsync('git', ['-C', dir, 'init', '-q', '-b', branch])
  await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'test'])
  await writeFile(join(dir, 'a.txt'), 'hello', 'utf8')
  await execFileAsync('git', ['-C', dir, 'add', '.'])
  await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', 'init', '--no-verify'])
}

// SPEC 7.1
describe('GitService.branch', () => {
  it('저장소의 현재 브랜치를 읽는다', async () => {
    await initRepo()
    expect(await service.branch(dir)).toBe('main')
  })

  it('브랜치를 바꾸면 따라간다', async () => {
    await initRepo()
    await execFileAsync('git', ['-C', dir, 'switch', '-q', '-c', 'feature/색-라벨'])
    expect(await service.branch(dir)).toBe('feature/색-라벨')
  })

  // 저장소가 아닌 폴더가 더 흔하다. 조용히 null이어야 한다.
  it('git 저장소가 아니면 null', async () => {
    expect(await service.branch(dir)).toBeNull()
  })

  it('없는 경로여도 던지지 않는다', async () => {
    await expect(service.branch(join(dir, 'nope'))).resolves.toBeNull()
  })

  it('detached HEAD면 짧은 해시를 준다', async () => {
    await initRepo()
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD'])
    await execFileAsync('git', ['-C', dir, 'checkout', '-q', stdout.trim()])

    const branch = await service.branch(dir)
    expect(branch).toMatch(/^@[0-9a-f]{7,}$/)
  })
})

// SPEC 16.2 / R20 — 바뀐 파일은 git이 1순위다.
describe('GitService.changes', () => {
  it('저장소가 아니면 root가 null이고 던지지 않는다', async () => {
    // 실제로 그런 노드가 있다 (git이 아닌 작업 폴더).
    expect(await service.changes(dir)).toEqual({ root: null, files: [], truncated: false })
  })

  it('깨끗한 저장소는 빈 목록이다', async () => {
    await initRepo()
    const result = await service.changes(dir)
    expect(result.root).not.toBeNull()
    expect(result.files).toEqual([])
  })

  it('수정·추가·삭제·추적되지 않은 파일을 구분한다', async () => {
    await initRepo()
    await writeFile(join(dir, 'a.txt'), 'changed', 'utf8') // 수정
    await writeFile(join(dir, 'new.txt'), 'new', 'utf8') // 추적되지 않음
    // 지울 파일을 먼저 커밋해 둔다. ⚠️ `staged.txt`를 스테이징하기 **전에**
    // 해야 한다 — `git commit`은 스테이징된 것을 전부 커밋한다.
    await writeFile(join(dir, 'gone.txt'), 'x', 'utf8')
    await execFileAsync('git', ['-C', dir, 'add', 'gone.txt'])
    await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', 'add gone', '--no-verify'])
    await rm(join(dir, 'gone.txt')) // 삭제

    await writeFile(join(dir, 'staged.txt'), 'staged', 'utf8')
    await execFileAsync('git', ['-C', dir, 'add', 'staged.txt']) // 추가

    const byPath = new Map((await service.changes(dir)).files.map((f) => [f.path, f.kind] as const))
    expect(byPath.get('a.txt')).toBe('modified')
    expect(byPath.get('new.txt')).toBe('untracked')
    expect(byPath.get('staged.txt')).toBe('added')
    expect(byPath.get('gone.txt')).toBe('deleted')
  })

  /**
   * `-z`를 쓰는 이유다. 기본 출력은 공백·한글 경로를 따옴표로 감싸고
   * 이스케이프해서 되돌리기가 번거롭다.
   */
  it('공백과 한글이 든 경로도 그대로 읽는다', async () => {
    await initRepo()
    await writeFile(join(dir, '내 파일 1.txt'), 'x', 'utf8')
    const paths = (await service.changes(dir)).files.map((f) => f.path)
    expect(paths).toContain('내 파일 1.txt')
  })

  it('이름을 바꾼 파일은 새 경로 하나로만 센다', async () => {
    await initRepo()
    await execFileAsync('git', ['-C', dir, 'mv', 'a.txt', 'b.txt'])
    const { files } = await service.changes(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toEqual({ path: 'b.txt', kind: 'renamed' })
  })

  /**
   * ⚠️ 기본값(`-unormal`)은 추적되지 않은 **디렉터리를 접어서** `sub/`로 준다.
   * 작업 기록에는 파일이 보여야 하므로 `-uall`을 쓴다.
   */
  it('하위 폴더에서 물어도 저장소 루트 기준 파일 경로로 준다', async () => {
    await initRepo()
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'c.txt'), 'x', 'utf8')
    const result = await service.changes(join(dir, 'sub'))
    expect(result.root).not.toBeNull()
    expect(result.files.map((f) => f.path)).toContain('sub/c.txt')
  })
})

// 파싱은 순수 함수라 따로 고정한다 — git을 돌리지 않고 경계를 볼 수 있다.
describe('parseStatusZ', () => {
  it('이름 바꾸기 항목의 옛 경로를 건너뛴다', () => {
    const { files } = parseStatusZ('R  new.ts\u0000old.ts\u0000 M other.ts\u0000')
    expect(files).toEqual([
      { path: 'new.ts', kind: 'renamed' },
      { path: 'other.ts', kind: 'modified' }
    ])
  })

  it('빈 입력·짧은 항목에도 던지지 않는다', () => {
    expect(parseStatusZ('').files).toEqual([])
    expect(parseStatusZ('\u0000\u0000').files).toEqual([])
    expect(parseStatusZ('M\u0000').files).toEqual([])
  })

  it('200개를 넘으면 자르고 알려 준다', () => {
    const raw = Array.from({ length: 250 }, (_, i) => ` M f${i}.ts`).join('\u0000') + '\u0000'
    const result = parseStatusZ(raw)
    expect(result.files).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })
})
