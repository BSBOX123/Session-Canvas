/**
 * 노드의 작업 폴더를 git으로 들여다본다 (SPEC 7.1 / 16.2).
 *
 * 브랜치는 노드 헤더에 `~/dev/lecturemate · main` 처럼 보여 주기 위한 것이라,
 * 실패는 전부 "브랜치 없음"으로 처리한다 — 저장소가 아닌 폴더가 더 흔하다.
 *
 * **바뀐 파일은 git이 1순위다** (SPEC 16.2 / R20). transcript의 `file-history`는
 * `Edit`·`Write` 도구를 거친 변경만 기록해서, 셸로 고친 파일은 흔적이 없다.
 * git은 어떤 방법으로 고쳤든 잡는다.
 *
 * ⚠️ **git은 "누가 바꿨는지"를 모른다.** 노드 둘이 같은 저장소를 가리키면
 * 두 노드에 같은 변경이 보인다. 그것을 숨기지 않고 **겹친다고 알려 준다**
 * (SPEC 19 단계 9의 "에이전트 간 파일 충돌 경고"가 이것이다).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 3000
/** 한 저장소에서 보여 줄 최대 파일 수. 대규모 변경에서 IPC가 터지지 않게 한다. */
const MAX_FILES = 200

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface ChangedFile {
  /** 저장소 루트 기준 상대 경로. */
  path: string
  kind: ChangeKind
}

export interface RepoChanges {
  /** 저장소 루트. **저장소가 아니면 null** — 그런 노드가 실제로 있다. */
  root: string | null
  files: ChangedFile[]
  /** `MAX_FILES`에서 잘렸는가. UI가 "더 있음"을 알려야 한다. */
  truncated: boolean
}

/**
 * `git status --porcelain=v1 -z` 한 줄의 상태 코드를 해석한다.
 *
 * 두 글자다 — 앞은 index, 뒤는 작업 트리. 우리는 "바뀌었다"만 보여 주므로
 * 둘 중 의미 있는 쪽을 쓴다.
 */
function kindOf(code: string): ChangeKind {
  if (code === '??') return 'untracked'
  // 이름 바꾸기는 R 또는 C(복사)로 온다.
  if (code.includes('R') || code.includes('C')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

/**
 * `-z` 출력을 파싱한다. **`-z`를 쓰는 이유**: 기본 출력은 공백·한글이 있는
 * 경로를 따옴표로 감싸고 이스케이프해서 되돌리기가 번거롭다. `-z`는 NUL로
 * 구분해 그대로 준다.
 *
 * 이름 바꾸기는 `XY new\0old\0`로 **항목 하나에 경로가 둘** 온다.
 */
export function parseStatusZ(raw: string): { files: ChangedFile[]; truncated: boolean } {
  const parts = raw.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    const kind = kindOf(code)
    // 이름 바꾸기면 다음 항목이 "옛 경로"다. 건너뛴다.
    if (kind === 'renamed') i += 1
    if (path.length === 0) continue
    if (files.length >= MAX_FILES) return { files, truncated: true }
    files.push({ path, kind })
  }
  return { files, truncated: false }
}

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

  /** 저장소 루트. 저장소가 아니면 `null`. */
  async root(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        env: this.env,
        timeout: TIMEOUT_MS
      })
      const root = stdout.trim()
      return root.length > 0 ? root : null
    } catch {
      return null
    }
  }

  /**
   * 지금 작업 트리에서 바뀐 파일 (SPEC 16.2).
   *
   * 커밋되지 않은 변경만 본다 — 에이전트가 **지금 손대고 있는 것**이 무엇인지가
   * 작업 기록에서 알고 싶은 것이다. "마지막 확인 지점 이후"라는 더 정확한 기준은
   * 단계 9에서 커밋 기준점과 함께 다룬다 (SPEC 17).
   *
   * 저장소가 아니면 `root: null`에 빈 목록이다. 던지지 않는다.
   */
  async changes(cwd: string): Promise<RepoChanges> {
    const root = await this.root(cwd)
    if (root === null) return { root: null, files: [], truncated: false }
    try {
      const { stdout } = await execFileAsync(
        'git',
        // `-uall`: 기본값은 추적되지 않은 **디렉터리를 접어서** `sub/`로 준다.
        // 작업 기록에는 파일 목록이 유용하므로 펼친다. 폭발은 `MAX_FILES`가 막는다.
        ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
        { env: this.env, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
      )
      return { root, ...parseStatusZ(stdout) }
    } catch {
      // 거대한 저장소에서 timeout이 날 수 있다. 기록이 비는 것뿐이다.
      return { root, files: [], truncated: false }
    }
  }
}
