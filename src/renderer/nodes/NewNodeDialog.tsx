import { useEffect, useRef, useState } from 'react'
import type { NewNodeInput } from '../state/workspace'

interface NewNodeDialogProps {
  onCancel(): void
  onCreate(input: Omit<NewNodeInput, 'position'>): void
}

/**
 * 노드 생성 대화상자 (SPEC 7.2).
 * 네이티브 `confirm`/`alert`은 쓰지 않는다 — 렌더러를 멈춰 세운다.
 */
function NewNodeDialog({ onCancel, onCreate }: NewNodeDialogProps): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')
  const [command, setCommand] = useState('claude')
  const [error, setError] = useState<string | null>(null)
  const cwdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cwdRef.current?.focus()
  }, [])

  const pickDirectory = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked !== null) {
      setCwd(picked)
      setError(null)
    }
  }

  const submit = (): void => {
    if (cwd.trim().length === 0) {
      setError('작업 폴더를 선택해 주세요.')
      return
    }
    onCreate({
      cwd: cwd.trim(),
      title: title.trim(),
      // 비우면 셸만 띄운다 (SPEC 7.2).
      command: command.trim().length === 0 ? null : command.trim()
    })
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-label="새 터미널 노드"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && e.metaKey) submit()
        }}
      >
        <h2>새 터미널 노드</h2>

        <label htmlFor="new-node-cwd">작업 폴더</label>
        <div className="dialog-row">
          <input
            id="new-node-cwd"
            ref={cwdRef}
            value={cwd}
            placeholder="/Users/me/dev/project"
            onChange={(e) => setCwd(e.target.value)}
          />
          <button type="button" onClick={() => void pickDirectory()}>
            폴더 선택
          </button>
        </div>

        <label htmlFor="new-node-title">제목 (선택)</label>
        <input
          id="new-node-title"
          value={title}
          placeholder="비우면 폴더명으로 표시"
          onChange={(e) => setTitle(e.target.value)}
        />

        <label htmlFor="new-node-command">실행 명령</label>
        <input
          id="new-node-command"
          value={command}
          placeholder="비우면 셸만"
          onChange={(e) => setCommand(e.target.value)}
        />

        {error !== null && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="primary" onClick={submit}>
            만들기
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewNodeDialog
