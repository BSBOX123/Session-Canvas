/**
 * `~/.session-canvas/status/` 감시 (SPEC 8.5).
 *
 * 훅은 노드당 파일 1개를 최신 이벤트로 덮어쓴다. 여기서는 그 변화를 보고
 * `mapEvent`로 해석해 renderer에 알린다.
 */
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { NODE_ID_PATTERN, type NodeId, type SessionState } from '../../shared/types'
import { mapEvent } from './mapEvent'

const DEBOUNCE_MS = 50

export interface StatusChange {
  nodeId: NodeId
  state: SessionState
  at: string
  claudeSessionId: string | null
}

export class StatusWatcher {
  private watcher: FSWatcher | null = null
  private readonly timers = new Map<NodeId, NodeJS.Timeout>()
  /** 워크스페이스에 없는 노드의 파일은 무시한다 (삭제하지는 않는다). */
  private known = new Set<NodeId>()
  /** 이 시각보다 오래된 상태 파일은 지난번 실행이 남긴 것이다 (SPEC 8.5). */
  private since = new Date(0)

  constructor(
    private readonly directory: string,
    private readonly onChange: (change: StatusChange) => void
  ) {}

  setKnownNodes(ids: NodeId[]): void {
    this.known = new Set(ids)
  }

  /**
   * 감시를 시작하고, 이미 있는 파일을 한 번 읽어 초기 상태로 쓴다.
   * `since`보다 오래된 파일은 무시한다 — 지난번 실행이 남긴 상태다 (SPEC 8.5).
   */
  async start(since: Date): Promise<void> {
    this.since = since

    // 디렉터리를 먼저 만든다. 없는 디렉터리를 watch하면 던지고, 그 뒤 훅이
    // 디렉터리를 만들어도 영영 눈치채지 못한다 — 처음 켠 사람에게는 상태
    // 감지가 통째로 죽는다는 뜻이다(실제로 그랬다).
    try {
      await mkdir(this.directory, { recursive: true })
    } catch (error) {
      console.warn('[session-canvas] 상태 디렉터리를 만들지 못했습니다:', error)
    }

    await this.readExisting()

    try {
      this.watcher = watch(this.directory, (_event, filename) => {
        if (typeof filename === 'string') this.schedule(filename)
      })
    } catch (error) {
      console.warn('[session-canvas] 상태 감시를 시작하지 못했습니다:', error)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private async readExisting(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch {
      return
    }
    for (const name of names) {
      const id = this.nodeIdOf(name)
      if (id === null) continue
      await this.read(id)
    }
  }

  /** `.tmp.*`는 무시한다 — 훅이 원자적 mv를 하려고 만든 중간 파일이다. */
  private nodeIdOf(filename: string): NodeId | null {
    if (filename.startsWith('.tmp.')) return null
    if (!filename.endsWith('.json')) return null
    const id = filename.slice(0, -'.json'.length)
    return NODE_ID_PATTERN.test(id) ? id : null
  }

  private schedule(filename: string): void {
    const id = this.nodeIdOf(filename)
    if (id === null) return
    const existing = this.timers.get(id)
    if (existing) clearTimeout(existing)
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        void this.read(id)
      }, DEBOUNCE_MS)
    )
  }

  private async read(id: NodeId): Promise<void> {
    if (!this.known.has(id)) return
    const path = join(this.directory, `${id}.json`)

    // 오래된 파일은 무시한다. 시작할 때 훑을 때뿐 아니라 감시 이벤트에도
    // 적용한다 — macOS의 FSEvents는 감시 시작 직전의 변경까지 전달한다.
    let raw: string
    try {
      const info = await stat(path)
      if (info.mtime < this.since) return
      raw = await readFile(path, 'utf8')
    } catch {
      return
    }
    const mapped = mapEvent(raw)
    if (mapped === null) return
    this.onChange({
      nodeId: id,
      state: mapped.state,
      at: new Date().toISOString(),
      claudeSessionId: mapped.claudeSessionId
    })
  }
}
