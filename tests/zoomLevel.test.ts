import { describe, expect, it } from 'vitest'
import {
  acceptsInput,
  boundsOf,
  ZOOM_DETAIL_MIN,
  ZOOM_PREVIEW_MIN,
  zoomLevelOf,
  zoomToFit
} from '../src/renderer/canvas/zoomLevel'

// SPEC 7.3
describe('zoomLevelOf', () => {
  it('상세: 0.75 이상', () => {
    expect(zoomLevelOf(2)).toBe('detail')
    expect(zoomLevelOf(1)).toBe('detail')
    expect(zoomLevelOf(ZOOM_DETAIL_MIN)).toBe('detail')
  })

  it('미리보기: 0.4 이상 0.75 미만', () => {
    expect(zoomLevelOf(ZOOM_DETAIL_MIN - 0.01)).toBe('preview')
    expect(zoomLevelOf(0.5)).toBe('preview')
    expect(zoomLevelOf(ZOOM_PREVIEW_MIN)).toBe('preview')
  })

  it('개요: 0.4 미만', () => {
    expect(zoomLevelOf(ZOOM_PREVIEW_MIN - 0.01)).toBe('overview')
    expect(zoomLevelOf(0.1)).toBe('overview')
  })

  it('상세 단계에서만 입력을 받는다', () => {
    expect(acceptsInput('detail')).toBe(true)
    expect(acceptsInput('preview')).toBe(false)
    expect(acceptsInput('overview')).toBe(false)
  })

  // 화면보다 큰 노드는 전체를 보려면 배율이 0.75 아래로 내려갈 수밖에 없다.
  // 그때 입력까지 막히면 그 노드를 쓸 방법이 없어진다.
  it('작업 중인 노드는 미리보기 단계에서도 입력을 받는다', () => {
    expect(acceptsInput('preview', true)).toBe(true)
    expect(acceptsInput('preview', false)).toBe(false)
  })

  it('개요 단계는 예외가 없다 — 터미널을 그리지도 않는다', () => {
    expect(acceptsInput('overview', true)).toBe(false)
  })
})

// 사용자 신고: 노드를 크게 키워 놓고 클릭하면 배율 1.0으로 고정돼 잘려 보였다.
describe('zoomToFit', () => {
  const viewport = { width: 1200, height: 800 }

  it('화면보다 큰 노드는 전체가 들어오도록 줄인다', () => {
    const zoom = zoomToFit({ width: 2400, height: 1600 }, viewport, { padding: 0 })
    expect(zoom).toBeCloseTo(0.5, 2)
  })

  it('가로·세로 중 더 빡빡한 쪽에 맞춘다', () => {
    // 가로는 2배 여유, 세로는 4배 부족 → 세로 기준
    const zoom = zoomToFit({ width: 600, height: 3200 }, viewport, { padding: 0 })
    expect(zoom).toBeCloseTo(0.25, 2)
  })

  it('작은 노드를 1.0 너머로 확대하지는 않는다', () => {
    // CSS transform으로 키운 터미널은 글자가 뭉개진다
    expect(zoomToFit({ width: 300, height: 200 }, viewport)).toBe(1)
  })

  it('여백만큼 더 줄인다', () => {
    const tight = zoomToFit({ width: 2400, height: 1600 }, viewport, { padding: 0 })
    const padded = zoomToFit({ width: 2400, height: 1600 }, viewport, { padding: 0.1 })
    expect(padded).toBeLessThan(tight)
  })

  it('minZoom 아래로는 내려가지 않는다', () => {
    const zoom = zoomToFit({ width: 100000, height: 100000 }, viewport, { minZoom: 0.1 })
    expect(zoom).toBe(0.1)
  })

  it('크기를 알 수 없으면 최대 배율로 둔다 (앱이 멈추면 안 된다)', () => {
    expect(zoomToFit({ width: 0, height: 0 }, viewport)).toBe(1)
    expect(zoomToFit({ width: 640, height: 420 }, { width: 0, height: 0 })).toBe(1)
  })
})

describe('boundsOf', () => {
  it('노드 여러 개를 감싸는 영역을 낸다', () => {
    expect(
      boundsOf([
        { position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
        { position: { x: 200, y: 100 }, size: { width: 100, height: 50 } }
      ])
    ).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })

  it('음수 좌표도 다룬다', () => {
    expect(
      boundsOf([
        { position: { x: -500, y: -200 }, size: { width: 100, height: 100 } },
        { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }
      ])
    ).toEqual({ x: -500, y: -200, width: 600, height: 300 })
  })

  it('노드가 없으면 null', () => {
    expect(boundsOf([])).toBeNull()
  })
})
