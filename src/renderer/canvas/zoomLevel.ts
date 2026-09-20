/**
 * 줌 단계 (SPEC 7.3).
 *
 * CSS transform으로 확대·축소된 터미널은 글자가 뭉개지므로, 줌 배율에 따라
 * 노드의 역할을 나눈다. 경계값은 여기 상수로 둔다.
 */
export type ZoomLevel = 'detail' | 'preview' | 'overview'

export const ZOOM_DETAIL_MIN = 0.75
export const ZOOM_PREVIEW_MIN = 0.4

/** 노드로 줌인할 때의 배율과 애니메이션 시간 (SPEC 7.3). */
export const ZOOM_TO_NODE = { zoom: 1, duration: 200 } as const

export function zoomLevelOf(zoom: number): ZoomLevel {
  if (zoom >= ZOOM_DETAIL_MIN) return 'detail'
  if (zoom >= ZOOM_PREVIEW_MIN) return 'preview'
  return 'overview'
}

/** 상세 단계에서만 터미널에 입력할 수 있다 (SPEC 7.3). */
export function acceptsInput(level: ZoomLevel): boolean {
  return level === 'detail'
}
