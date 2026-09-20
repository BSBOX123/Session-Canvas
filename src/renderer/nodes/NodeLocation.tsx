import { useEffect, useState } from 'react'
import type { TerminalNodeData } from '@shared/types'

/** 30초마다 한 번씩 다시 읽는다 (SPEC 7.1). */
const REFRESH_MS = 30_000

/** 홈 아래 경로는 `~`로 줄여 보여 준다. */
function shortenPath(cwd: string, home: string | null): string {
  if (home !== null && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`
  return cwd
}

/**
 * 헤더 둘째 줄: `~/dev/lecturemate · main` (SPEC 7.1).
 * git 저장소가 아니면 경로만 보여 준다.
 */
function NodeLocation({
  node,
  active
}: {
  node: TerminalNodeData
  active: boolean
}): React.JSX.Element {
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const read = (): void => {
      void window.api.git.branch(node.cwd).then((value) => {
        if (!cancelled) setBranch(value)
      })
    }
    read()
    // 포커스된 노드만 주기적으로 갱신한다 — 노드가 많을 때 git을 계속 부르면
    // 그것만으로도 부담이다.
    if (!active)
      return () => {
        cancelled = true
      }
    const timer = window.setInterval(read, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [node.cwd, active])

  const home = node.cwd.startsWith('/Users/') ? node.cwd.split('/').slice(0, 3).join('/') : null

  return (
    <div className="node-location" title={node.cwd}>
      <span className="node-location-path">{shortenPath(node.cwd, home)}</span>
      {branch !== null && (
        <>
          <span className="node-location-sep"> · </span>
          <span className="node-location-branch">{branch}</span>
        </>
      )}
    </div>
  )
}

export default NodeLocation
