import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { DEFAULT_SETTINGS, type NodeId } from '@shared/types'

interface XtermViewProps {
  nodeId: NodeId
  cwd: string | null
  command: string | null
}

/**
 * 노드 하나의 터미널 (SPEC 6장).
 *
 * 단계 1은 창 하나 = 터미널 하나다. 언마운트되어도 버퍼를 지키는
 * `TerminalRegistry`(SPEC 6.4)와 WebGL 렌더러 정책(SPEC 6.3)은 단계 2·5에서
 * 붙인다.
 */
function XtermView({ nodeId, cwd, command }: XtermViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const terminal = new Terminal({
      fontFamily: DEFAULT_SETTINGS.fontFamily,
      fontSize: DEFAULT_SETTINGS.fontSize,
      // unicode11 애드온이 제안 API를 쓴다.
      allowProposedApi: true,
      // SPEC 6.5
      macOptionClickForcesSelection: true,
      macOptionIsMeta: false,
      cursorBlink: true,
      scrollback: 10_000,
      theme: { background: '#14161a', foreground: '#e6e8eb' }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    // SPEC 6.1: 한글 등 전각 문자 폭 계산 — 활성화 필수.
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.loadAddon(new ClipboardAddon())
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(host)
    fitAddon.fit()

    const offData = window.api.pty.onData((id, data) => {
      if (id === nodeId) terminal.write(data)
    })
    const offExit = window.api.pty.onExit((id, code) => {
      if (id === nodeId) terminal.write(`\r\n\x1b[90m[프로세스 종료: ${code}]\x1b[0m\r\n`)
    })
    const inputSub = terminal.onData((data) => window.api.pty.write(nodeId, data))

    void window.api.pty
      .open({ id: nodeId, cwd, command }, terminal.cols, terminal.rows)
      .then(() => terminal.focus())
      .catch((error: unknown) => {
        terminal.write(`\r\n\x1b[31m터미널을 열지 못했습니다: ${String(error)}\x1b[0m\r\n`)
      })

    // 크기가 바뀌면 fit → pty.resize (SPEC 7.1).
    let lastCols = terminal.cols
    let lastRows = terminal.rows
    const resize = (): void => {
      fitAddon.fit()
      if (terminal.cols === lastCols && terminal.rows === lastRows) return
      lastCols = terminal.cols
      lastRows = terminal.rows
      window.api.pty.resize(nodeId, terminal.cols, terminal.rows)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    if (import.meta.env.DEV) {
      // 개발용 점검 훅 (scripts/inspect-renderer.mjs, SPEC 14.3).
      window.__sessionCanvas = {
        terminals: { ...window.__sessionCanvas?.terminals, [nodeId]: terminal }
      }
    }

    return () => {
      observer.disconnect()
      inputSub.dispose()
      offData()
      offExit()
      void window.api.pty.detach(nodeId)
      terminal.dispose()
    }
  }, [nodeId, cwd, command])

  return <div className="xterm-host" ref={hostRef} />
}

export default XtermView
