import { useEffect } from 'react'
import type { WorkLogEntry, WorkLogView } from '@shared/ipc'
import { useWorkLog } from '../state/workLog'
import { useWorkspace } from '../state/workspace'
import { displayTitle } from '../nodes/displayTitle'

/** 타임라인에 한 번에 보여 줄 줄 수. 더 보기는 단계 9에서 다룬다. */
const SHOW = 24

const KIND_LABEL: Record<WorkLogView['changes']['files'][number]['kind'], string> = {
  added: '추가',
  modified: '수정',
  deleted: '삭제',
  renamed: '이름',
  untracked: '새 파일'
}

function timeOf(at: string | null): string {
  if (at === null) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Entry({ entry }: { entry: WorkLogEntry }): React.JSX.Element {
  return (
    <li className={`worklog-entry ${entry.kind}`}>
      <span className="worklog-time">{timeOf(entry.at)}</span>
      <span className="worklog-mark">{entry.kind === 'prompt' ? '▸' : '·'}</span>
      <span className="worklog-text">
        {entry.text}
        {entry.detail !== null && <span className="worklog-detail">{entry.detail}</span>}
      </span>
    </li>
  )
}

/**
 * 작업 기록 패널 (SPEC 19 단계 8).
 *
 * **고정 패널이지 노드가 아니다.** SPEC 15.2의 기준대로 — 여러 개를 동시에
 * 비교하는 것만 노드로 만들고, 한 노드의 것을 보는 것은 패널에 둔다. 터미널을
 * 가리지 않는 것도 이유다.
 *
 * 포커스된 노드의 기록을 보여 준다. 포커스가 바뀔 때와 그 노드에 상태 이벤트가
 * 올 때만 다시 읽는다 (폴링하지 않는다).
 */
function WorkLogPanel({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const focusedId = useWorkspace((s) => s.focusedNodeId)
  const node = useWorkspace((s) => s.nodes.find((n) => n.id === s.focusedNodeId) ?? null)
  // 상태 이벤트가 오면 `at`이 바뀐다. 그걸 갱신 신호로 쓴다.
  const statusAt = useWorkspace((s) =>
    focusedId === null ? null : (s.statuses[focusedId]?.at ?? null)
  )
  const view = useWorkLog((s) => (focusedId === null ? undefined : s.views[focusedId]))
  const loading = useWorkLog((s) => (focusedId === null ? false : s.loading.has(focusedId)))
  const refresh = useWorkLog((s) => s.refresh)

  useEffect(() => {
    if (node === null) return
    void refresh(node)
    // `statusAt`이 바뀌면 다시 읽는다. node 전체를 의존성에 넣으면 리사이즈
    // 같은 무관한 변경에도 다시 읽는다.
  }, [node?.id, statusAt, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  if (node === null) {
    return (
      <aside className="worklog">
        <header className="worklog-head">
          <h2>작업 기록</h2>
          <button type="button" className="worklog-close" onClick={onClose} aria-label="패널 닫기">
            ×
          </button>
        </header>
        <p className="worklog-empty">노드를 선택하면 그 에이전트가 한 일이 보입니다.</p>
      </aside>
    )
  }

  const changed = view?.changes.files ?? []
  const tools = Object.entries(view?.toolCounts ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <aside className="worklog">
      <header className="worklog-head">
        <h2>{displayTitle(node)}</h2>
        <button type="button" className="worklog-close" onClick={onClose} aria-label="패널 닫기">
          ×
        </button>
      </header>

      {view?.activity != null && (
        <p className="worklog-now">
          <span className="worklog-now-label">지금</span>
          {view.activity}
        </p>
      )}

      {/* 기록이 **없는 것**과 **못 읽은 것**은 다르다 (SPEC 16.3). */}
      {view?.transcriptMissing === true && (
        <p className="worklog-note">
          대화 기록을 읽지 못했습니다. 상태 감지를 켜고 이 노드에서 한 번 작업하면 채워집니다. 아래
          변경 파일은 git에서 읽은 것이라 그대로 맞습니다.
        </p>
      )}

      <section className="worklog-section">
        <h3>
          바뀐 파일{' '}
          <span className="worklog-count">
            {view === undefined
              ? '…'
              : view.changes.root === null
                ? 'git 저장소 아님'
                : changed.length}
          </span>
        </h3>
        {changed.length > 0 && (
          <ul className="worklog-files">
            {changed.map((f) => (
              <li key={f.path} className={`worklog-file ${f.kind}`}>
                <span className="worklog-file-kind">{KIND_LABEL[f.kind]}</span>
                <span className="worklog-file-path">{f.path}</span>
              </li>
            ))}
          </ul>
        )}
        {view?.changes.truncated === true && (
          <p className="worklog-note">너무 많아 일부만 보여 줍니다.</p>
        )}
      </section>

      <section className="worklog-section">
        <h3>
          한 일 {loading && <span className="worklog-count">읽는 중…</span>}
          {tools.length > 0 && (
            <span className="worklog-count">
              {tools
                .slice(0, 4)
                .map(([name, n]) => `${name} ${n}`)
                .join(' · ')}
            </span>
          )}
        </h3>
        {view !== undefined && view.timeline.length === 0 && !view.transcriptMissing && (
          <p className="worklog-empty">아직 기록이 없습니다.</p>
        )}
        <ul className="worklog-timeline">
          {(view?.timeline ?? []).slice(0, SHOW).map((entry, i) => (
            <Entry key={`${entry.at ?? ''}-${entry.text}-${i}`} entry={entry} />
          ))}
        </ul>
      </section>
    </aside>
  )
}

export default WorkLogPanel
