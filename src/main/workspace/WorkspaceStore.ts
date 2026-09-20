/**
 * workspace.json 읽기/쓰기 (SPEC 9.2).
 *
 * - 위치: `app.getPath('userData')/workspace.json`
 * - 변경 후 500ms 디바운스, 임시 파일에 쓰고 rename(원자적)
 * - 직전 버전 1개를 `.bak`로 유지
 * - 파싱 실패 시 `.bak` → 그래도 실패하면 빈 워크스페이스, 손상 파일은 보존
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Workspace } from '../../shared/types'
import { emptyWorkspace, parseWorkspace, serializeWorkspace } from './serialize'

const SAVE_DEBOUNCE_MS = 500

export type LoadStatus =
  'ok' | 'empty' | 'recovered-from-backup' | 'corrupt' | 'unsupported-version'

export interface LoadResult {
  workspace: Workspace
  status: LoadStatus
  /** 사용자에게 보여줄 한 줄. 정상일 때는 null. */
  message: string | null
}

export class WorkspaceStore {
  private readonly backupPath: string
  private timer: NodeJS.Timeout | null = null
  private pending: Workspace | null = null
  /** 상위 버전 파일을 만나면 덮어쓰지 않는다 (SPEC 9.2). */
  private readOnly = false

  constructor(private readonly filePath: string) {
    this.backupPath = `${filePath}.bak`
  }

  async load(): Promise<LoadResult> {
    const primary = await this.tryRead(this.filePath)

    if (primary?.status === 'ok')
      return { workspace: primary.workspace, status: 'ok', message: null }

    if (primary?.status === 'unsupported-version') {
      this.readOnly = true
      return {
        workspace: emptyWorkspace(),
        status: 'unsupported-version',
        message: `더 새로운 버전(${primary.version})의 워크스페이스 파일입니다. 덮어쓰지 않기 위해 읽기 전용으로 둡니다.`
      }
    }

    if (primary === null) {
      return { workspace: emptyWorkspace(), status: 'empty', message: null }
    }

    // 손상 — 백업으로 한 번 더 시도한다.
    const preserved = await this.preserveCorrupt()
    const backup = await this.tryRead(this.backupPath)
    if (backup?.status === 'ok') {
      return {
        workspace: backup.workspace,
        status: 'recovered-from-backup',
        message: `워크스페이스 파일이 손상되어 백업에서 복구했습니다. 손상된 파일은 ${preserved ?? '보존하지 못했습니다'}`
      }
    }

    return {
      workspace: emptyWorkspace(),
      status: 'corrupt',
      message: `워크스페이스 파일을 읽지 못해 빈 화면으로 시작합니다. 손상된 파일은 ${preserved ?? '보존하지 못했습니다'}`
    }
  }

  /** 500ms 디바운스. 마지막 값만 쓴다. */
  save(workspace: Workspace): void {
    if (this.readOnly) return
    this.pending = workspace
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 종료 직전처럼 기다릴 수 없을 때. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const workspace = this.pending
    if (workspace === null || this.readOnly) return
    this.pending = null

    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      // 직전 버전을 백업으로 남긴다. 처음 저장이면 원본이 없어 그냥 넘어간다.
      await copyFile(this.filePath, this.backupPath).catch(() => undefined)

      const tempPath = `${this.filePath}.tmp-${process.pid}`
      await writeFile(tempPath, serializeWorkspace(workspace), 'utf8')
      await rename(tempPath, this.filePath)
    } catch (error) {
      console.error('[session-canvas] 워크스페이스 저장 실패:', error)
    }
  }

  private async tryRead(path: string): Promise<ReturnType<typeof parseWorkspace> | null> {
    try {
      return parseWorkspace(await readFile(path, 'utf8'))
    } catch {
      // 파일이 없는 것과 읽기 실패를 구분하지 않는다 — 둘 다 "없음"으로 본다.
      return null
    }
  }

  /** 손상 파일을 지우지 않고 이름만 바꿔 남긴다 (SPEC 9.2). */
  private async preserveCorrupt(): Promise<string | null> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(dirname(this.filePath), `workspace.corrupt-${stamp}.json`)
    try {
      await copyFile(this.filePath, target)
      return target
    } catch {
      return null
    }
  }
}
