import { describe, expect, it } from 'vitest'
import {
  acceptsInput,
  ZOOM_DETAIL_MIN,
  ZOOM_PREVIEW_MIN,
  zoomLevelOf
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
})
