/**
 * 줌 단계 (SPEC 7.3).
 *
 * CSS transform으로 확대·축소된 터미널은 글자가 뭉개지므로, 줌 배율에 따라
 * 노드의 역할을 나눈다. 경계값은 여기 상수로 둔다.
 */
export type ZoomLevel = 'detail' | 'preview' | 'overview'

export const ZOOM_DETAIL_MIN = 0.75
export const ZOOM_PREVIEW_MIN = 0.4

/**
 * 노드로 줌인할 때 쓰는 `fitView` 옵션 (SPEC 7.3).
 *
 * 배율을 1.0으로 고정하면 **화면보다 큰 노드는 잘린다.** 노드가 통째로
 * 들어오도록 맞추되, 작은 노드를 1.0 너머로 확대하지는 않는다 — CSS
 * transform으로 키운 터미널은 글자가 뭉개진다.
 */
export const ZOOM_TO_NODE = { maxZoom: 1, padding: 0.08, duration: 200 } as const

export function zoomLevelOf(zoom: number): ZoomLevel {
  if (zoom >= ZOOM_DETAIL_MIN) return 'detail'
  if (zoom >= ZOOM_PREVIEW_MIN) return 'preview'
  return 'overview'
}

/**
 * 터미널에 입력할 수 있는가 (SPEC 7.3).
 *
 * 기본은 상세 단계에서만이다. 다만 **지금 작업 중인 노드**는 미리보기
 * 단계에서도 입력을 받는다 — 화면보다 큰 노드는 통째로 보려면 배율이
 * 0.75 아래로 내려갈 수밖에 없는데, 그때 입력이 막히면 그 노드를 쓸 방법이
 * 없어진다. 개요 단계는 터미널을 그리지도 않으므로 예외가 없다.
 */
export function acceptsInput(level: ZoomLevel, focused = false): boolean {
  if (level === 'detail') return true
  return level === 'preview' && focused
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 어떤 영역을 화면에 담으려면 배율이 얼마여야 하는가.
 *
 * React Flow의 `fitView`를 쓰지 않는 이유: 그 함수는 내부 노드 변경 큐를
 * 거쳐야 resolve되는데, 우리가 리사이즈를 고치려고 노드에 `measured`를
 * 넘기기 시작하면서 변경이 0건이 되어 그 경로가 끊겼다. 제어 모드에서는
 * 영영 resolve되지 않고 화면도 움직이지 않는다. 그래서 직접 계산한다.
 */
/**
 * 뷰포트 이동 애니메이션 시간.
 *
 * ⚠️ 창이 가려져 있으면 Chromium이 `requestAnimationFrame`을 멈춰서
 * **애니메이션이 한 프레임도 돌지 않고 화면이 영영 움직이지 않는다.**
 * 알림을 클릭해 노드로 줌인하는 경로(SPEC 8.6)가 정확히 그 상황이다.
 * 보이지 않을 때는 애니메이션 없이 즉시 옮긴다.
 */
export function viewportDuration(): number {
  if (typeof document === 'undefined') return 0
  return document.visibilityState === 'visible' ? ZOOM_TO_NODE.duration : 0
}

export function zoomToFit(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { padding?: number; maxZoom?: number; minZoom?: number } = {}
): number {
  const { padding = 0.08, maxZoom = 1, minZoom = 0.1 } = options
  if (content.width <= 0 || content.height <= 0) return maxZoom
  if (viewport.width <= 0 || viewport.height <= 0) return maxZoom

  const usable = 1 - padding * 2
  const fit = Math.min(
    (viewport.width * usable) / content.width,
    (viewport.height * usable) / content.height
  )
  return Math.min(maxZoom, Math.max(minZoom, fit))
}

/** 노드 여러 개를 감싸는 영역. */
export function boundsOf(
  nodes: { position: { x: number; y: number }; size: { width: number; height: number } }[]
): Rect | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.size.width)
    maxY = Math.max(maxY, node.position.y + node.size.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
