/**
 * 노드의 작업 폴더가 git 저장소면 현재 브랜치를 읽어 온다 (SPEC 7.1).
 *
 * 노드 헤더에 `~/dev/lecturemate · main` 처럼 보여 주기 위한 것이라,
 * 실패는 전부 "브랜치 없음"으로 처리한다 — 저장소가 아닌 폴더가 더 흔하다.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 3000

export class GitService {
  constructor(private readonly env: NodeJS.ProcessEnv) {}

  /**
   * 현재 브랜치 이름. 저장소가 아니거나 detached HEAD면 null.
   * detached HEAD에서는 짧은 커밋 해시를 대신 준다.
   */
  async branch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
        {
          env: this.env,
          timeout: TIMEOUT_MS
        }
      )
      const name = stdout.trim()
      if (name.length === 0) return null
      if (name !== 'HEAD') return name

      // detached HEAD — 브랜치 이름이 없으니 해시를 보여 준다.
      const { stdout: hash } = await execFileAsync(
        'git',
        ['-C', cwd, 'rev-parse', '--short', 'HEAD'],
        { env: this.env, timeout: TIMEOUT_MS }
      )
      const short = hash.trim()
      return short.length > 0 ? `@${short}` : null
    } catch {
      // 저장소가 아니거나 git이 없다. 둘 다 표시할 게 없는 것뿐이다.
      return null
    }
  }
}
