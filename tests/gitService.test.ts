import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { GitService } from '../src/main/git/GitService'

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
