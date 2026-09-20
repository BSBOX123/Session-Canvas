/**
 * `~/.claude/settings.json`에 우리 훅을 **추가 병합**한다 (SPEC 8.4).
 * 순수 함수 — 단위 테스트 대상.
 *
 * 원칙:
 *  - 사용자의 기존 hooks와 다른 설정은 **한 글자도 바꾸지 않는다**
 *  - 멱등: 같은 명령 경로가 이미 있으면 추가하지 않는다
 *  - 제거할 때는 우리 명령 경로를 가진 항목만 없앤다
 *  - 파싱 실패 시 아무것도 쓰지 않는다 (호출부에서 처리)
 */

/** SPEC 8.2의 매핑이 필요로 하는 이벤트들. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

/** 훅이 멈춰도 Claude Code가 오래 기다리지 않게 한다. 기본값은 600초다. */
export const HOOK_TIMEOUT_SECONDS = 5

export type InstallState = 'installed' | 'not-installed' | 'outdated'

interface CommandHook {
  type: string
  command?: string
  [key: string]: unknown
}

interface HookGroup {
  matcher?: string
  hooks?: CommandHook[]
  [key: string]: unknown
}

type Settings = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function groupsOf(settings: Settings, event: string): HookGroup[] {
  const hooks = settings.hooks
  if (!isRecord(hooks)) return []
  const groups = hooks[event]
  return Array.isArray(groups) ? (groups.filter(isRecord) as HookGroup[]) : []
}

function ourHooks(group: HookGroup, command: string): CommandHook[] {
  return (group.hooks ?? []).filter((hook) => isRecord(hook) && hook.command === command)
}

/** 우리 명령이 그 이벤트에 이미 걸려 있는가. */
function hasCommand(settings: Settings, event: string, command: string): boolean {
  return groupsOf(settings, event).some((group) => ourHooks(group, command).length > 0)
}

/**
 * 설치 상태. 일부 이벤트에만 걸려 있으면 `outdated` — 이벤트 목록이 늘어난
 * 새 버전으로 올라온 경우다.
 */
export function installState(settings: Settings, command: string): InstallState {
  const present = HOOK_EVENTS.filter((event) => hasCommand(settings, event, command))
  if (present.length === 0) return 'not-installed'
  return present.length === HOOK_EVENTS.length ? 'installed' : 'outdated'
}

/** 우리 훅을 더한 새 설정을 돌려준다. 입력은 바꾸지 않는다. */
export function withHooks(settings: Settings, command: string): Settings {
  const existingHooks = isRecord(settings.hooks) ? settings.hooks : {}
  const nextHooks: Record<string, unknown> = { ...existingHooks }

  for (const event of HOOK_EVENTS) {
    const groups = groupsOf(settings, event)
    if (groups.some((group) => ourHooks(group, command).length > 0)) {
      // 멱등: 이미 있으면 그대로 둔다.
      continue
    }
    nextHooks[event] = [
      ...groups,
      { hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] }
    ]
  }

  return { ...settings, hooks: nextHooks }
}

/** 우리 명령을 가진 항목만 걷어낸 새 설정을 돌려준다. */
export function withoutHooks(settings: Settings, command: string): Settings {
  if (!isRecord(settings.hooks)) return { ...settings }

  const nextHooks: Record<string, unknown> = {}
  for (const [event, value] of Object.entries(settings.hooks)) {
    if (!Array.isArray(value)) {
      nextHooks[event] = value
      continue
    }
    const groups = value
      .map((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) return group
        const kept = group.hooks.filter((hook) => !isRecord(hook) || hook.command !== command)
        if (kept.length === group.hooks.length) return group
        // 우리 것만 있던 그룹은 통째로 없앤다. 남은 게 있으면 그 그룹은 지킨다.
        return kept.length === 0 ? null : { ...group, hooks: kept }
      })
      .filter((group) => group !== null)

    if (groups.length > 0) nextHooks[event] = groups
  }

  const next: Settings = { ...settings }
  if (Object.keys(nextHooks).length === 0) delete next.hooks
  else next.hooks = nextHooks
  return next
}
