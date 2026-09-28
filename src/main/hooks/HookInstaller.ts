/**
 * 훅 스크립트 설치와 에이전트 설정 병합 (SPEC 8.4 / 21.4).
 *
 * 에이전트마다 인스턴스를 하나씩 만든다. Claude Code는
 * `~/.claude/settings.json`, Codex는 `~/.codex/hooks.json`이다. JSON 구조가
 * 같아서(실측) 병합 코드는 공유하고 **경로와 이벤트 목록만** 다르다.
 *
 * ⚠️ **Codex는 파일을 고치는 것으로 끝나지 않는다.** 사용자가 Codex에서
 * `/hooks`로 승인해야 훅이 실행된다 (SPEC 21.2). 그 안내는 UI가 한다.
 *
 * ⚠️ 이 클래스는 **사용자 전역 설정을 건드리는 유일한 곳**이다 (SPEC 0.4).
 * 앱 UI에서 명시적 동의를 받은 뒤에만 호출해야 하고, 쓰기 전에 반드시
 * 백업한다. 경로는 전부 생성자로 받는다 — 테스트가 임시 HOME을 쓸 수 있어야
 * 하고, 실수로 진짜 설정을 건드리는 일이 없어야 한다.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  installState,
  withHooks,
  withoutHooks,
  type HookEvents,
  type InstallState
} from './mergeSettings'

export interface HookInstallerPaths {
  /** 원본 스크립트 (`resources/hooks/session-canvas-hook.sh`). */
  source: string
  /** 설치 위치 (`~/.session-canvas/bin/session-canvas-hook.sh`). */
  target: string
  /** 병합할 설정 파일 (`~/.claude/settings.json` 또는 `~/.codex/hooks.json`). */
  settings: string
  /** 그 에이전트가 실제로 주는 이벤트만 등록한다 (SPEC 21.1). */
  events: HookEvents
  /** 설치 후 사용자가 직접 승인해야 하는가 (Codex, SPEC 21.2). */
  needsApproval: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  /**
   * 설정 파일을 읽는다. 없으면 빈 설정, **파싱 실패면 던진다** — 읽지 못한
   * 파일을 덮어쓰는 일은 없어야 한다 (SPEC 8.4).
   */
  private async readSettings(): Promise<Record<string, unknown>> {
    let raw: string
    try {
      raw = await readFile(this.paths.settings, 'utf8')
    } catch {
      return {}
    }
    if (raw.trim().length === 0) return {}

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(
        `${this.paths.settings}를 읽지 못했습니다(JSON 오류). 아무것도 바꾸지 않았습니다: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    if (!isRecord(parsed)) {
      throw new Error(
        `${this.paths.settings}의 최상위가 객체가 아닙니다. 아무것도 바꾸지 않았습니다.`
      )
    }
    return parsed
  }

  private async backup(): Promise<string | null> {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, '')
      .replace('T', '-')
    const target = `${this.paths.settings}.bak-${stamp}`
    try {
      await copyFile(this.paths.settings, target)
      return target
    } catch {
      // 원본이 없으면 백업할 것도 없다.
      return null
    }
  }

  private async write(settings: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.paths.settings), { recursive: true })
    const tempPath = `${this.paths.settings}.tmp-${process.pid}`
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    const { rename } = await import('node:fs/promises')
    await rename(tempPath, this.paths.settings)
  }

  async state(): Promise<InstallState> {
    try {
      return installState(await this.readSettings(), this.paths.target, this.paths.events)
    } catch {
      // 읽지 못하는 설정은 "설치 안 됨"으로 본다. 쓰기는 어차피 거부된다.
      return 'not-installed'
    }
  }

  /** 이 에이전트가 사용자 승인을 요구하는가 (SPEC 21.2). */
  get needsApproval(): boolean {
    return this.paths.needsApproval
  }

  /** 스크립트 복사 → 설정 백업 → 병합. 실패하면 설정은 손대지 않는다. */
  async install(): Promise<{ backup: string | null }> {
    const settings = await this.readSettings()

    await mkdir(dirname(this.paths.target), { recursive: true })
    await copyFile(this.paths.source, this.paths.target)
    await chmod(this.paths.target, 0o755)

    const backup = await this.backup()
    await this.write(withHooks(settings, this.paths.target, this.paths.events))
    return { backup }
  }

  /** 우리 명령을 가진 항목만 걷어낸다. 스크립트 파일은 남겨 둔다. */
  async uninstall(): Promise<{ backup: string | null }> {
    const settings = await this.readSettings()
    const backup = await this.backup()
    await this.write(withoutHooks(settings, this.paths.target))
    return { backup }
  }
}
