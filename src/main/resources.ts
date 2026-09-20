import { join } from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * `resources/` 안의 파일 경로. tmux 같은 외부 프로세스에 넘기는 경로라
 * asar 안이 아니라 **실제 파일**을 가리켜야 한다.
 *
 * 개발: 프로젝트 루트의 `resources/`
 * 패키징: `process.resourcesPath` (electron-builder.yml의 `extraResources`)
 *
 * 패키징된 앱에서의 확인은 단계 6 (SPEC 12.1).
 */
export function resourcePath(name: string): string {
  return is.dev ? join(app.getAppPath(), 'resources', name) : join(process.resourcesPath, name)
}
