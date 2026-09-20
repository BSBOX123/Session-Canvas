import { useEffect, useRef } from 'react'
import type { TerminalNodeData } from '@shared/types'
import { acquire, fitAndResize } from './TerminalRegistry'

interface XtermViewProps {
  node: TerminalNodeData
}

/**
 * 레지스트리가 들고 있는 터미널을 화면에 붙이는 얇은 껍데기 (SPEC 6.4).
 * 여기서는 `Terminal`을 만들지도, 버리지도 않는다.
 */
function XtermView({ node }: XtermViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const { host } = acquire(node, container)
    const observer = new ResizeObserver(() => fitAndResize(node.id))
    observer.observe(container)

    return () => {
      observer.disconnect()
      // host는 떼어내기만 한다. dispose는 노드를 닫을 때만 (SPEC 6.4).
      host.remove()
    }
    // 터미널의 수명은 노드 id에만 달려 있다. cwd·command는 생성 시점에만 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  return (
    // SPEC 7.1: 터미널 영역은 캔버스 조작에서 제외한다.
    <div className="terminal-area nodrag nowheel nopan" ref={containerRef} />
  )
}

export default XtermView
