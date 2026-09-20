/**
 * SPEC 6.4 — React 노드가 언마운트되어도 터미널 버퍼가 사라지면 안 된다.
 *
 * 그래서 노드별 `{ terminal, host }`를 React 바깥인 이 모듈이 들고 있는다.
 *  - `terminal.open(host)`는 **최초 1회만**
 *  - `XtermView`는 마운트 시 host를 자기 DOM에 붙이고, 언마운트 시 떼어낼 뿐
 *  - `dispose`는 노드를 닫거나 세션을 종료할 때만
 *
 * PTY 출력 구독도 여기 있다. 뷰에 두면 언마운트된 노드의 출력이 유실된다.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { DEFAULT_SETTINGS, type NodeId, type TerminalNodeData } from '@shared/types'

export interface TerminalEntry {
  terminal: Terminal
  fit: FitAddon
  host: HTMLDivElement
}

const entries = new Map<NodeId, TerminalEntry>()
let subscribed = false

/** 살아 있는 노드에만 출력을 흘린다. 앱 전체에서 한 번만 구독한다. */
function subscribeOnce(): void {
  if (subscribed) return
  subscribed = true
  window.api.pty.onData((id, data) => {
    entries.get(id)?.terminal.write(data)
  })
  window.api.pty.onExit((id, code) => {
    entries.get(id)?.terminal.write(`\r\n\x1b[90m[프로세스 종료: ${code}]\x1b[0m\r\n`)
  })
}

function createTerminal(): { terminal: Terminal; fit: FitAddon } {
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

  const fit = new FitAddon()
  terminal.loadAddon(fit)
  // SPEC 6.1: 한글 등 전각 문자 폭 계산 — 활성화 필수.
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(new ClipboardAddon())
  terminal.loadAddon(new WebLinksAddon())
  return { terminal, fit }
}

/**
 * 노드의 터미널을 가져온다. 없으면 만들고 PTY를 연다.
 * `container`는 최초 1회 `terminal.open()`에 쓸 부모 엘리먼트다 — xterm이
 * 글자 크기를 재려면 화면에 붙어 있어야 한다.
 */
export function acquire(node: TerminalNodeData, container: HTMLElement): TerminalEntry {
  subscribeOnce()

  const existing = entries.get(node.id)
  if (existing) {
    // 재마운트: host를 새 컨테이너로 옮기기만 한다. open은 다시 부르지 않는다.
    if (existing.host.parentElement !== container) container.appendChild(existing.host)
    existing.fit.fit()
    return existing
  }

  const host = document.createElement('div')
  host.className = 'xterm-host'
  container.appendChild(host)

  const { terminal, fit } = createTerminal()
  terminal.open(host)
  fit.fit()

  const entry: TerminalEntry = { terminal, fit, host }
  entries.set(node.id, entry)

  terminal.onData((data) => window.api.pty.write(node.id, data))

  void window.api.pty
    .open({ id: node.id, cwd: node.cwd, command: node.command }, terminal.cols, terminal.rows)
    .catch((error: unknown) => {
      terminal.write(`\r\n\x1b[31m터미널을 열지 못했습니다: ${String(error)}\x1b[0m\r\n`)
    })

  return entry
}

/** 크기 변경 → fit → `pty.resize`. 값이 안 바뀌면 IPC를 보내지 않는다. */
export function fitAndResize(id: NodeId): void {
  const entry = entries.get(id)
  if (!entry) return
  const { terminal, fit } = entry
  const before = { cols: terminal.cols, rows: terminal.rows }
  fit.fit()
  if (terminal.cols === before.cols && terminal.rows === before.rows) return
  window.api.pty.resize(id, terminal.cols, terminal.rows)
}

export function get(id: NodeId): TerminalEntry | undefined {
  return entries.get(id)
}

export function focus(id: NodeId): void {
  entries.get(id)?.terminal.focus()
}

/** 노드를 닫을 때만 부른다 (SPEC 6.4). PTY도 함께 정리한다. */
export function dispose(id: NodeId): void {
  const entry = entries.get(id)
  if (!entry) return
  entries.delete(id)
  void window.api.pty.detach(id)
  entry.terminal.dispose()
  entry.host.remove()
}

/** 개발 모드 점검용 (SPEC 14.3). */
export function debugTerminals(): Record<NodeId, Terminal> {
  return Object.fromEntries([...entries].map(([id, entry]) => [id, entry.terminal]))
}
