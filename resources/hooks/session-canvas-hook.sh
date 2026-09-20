#!/bin/sh
# Claude Code hook → Session Canvas 상태 파일 (SPEC 8.3).
#
# 이 스크립트는 사용자의 전역 설정에 등록되므로, **앱 밖에서 실행된 Claude
# Code에서는 아무것도 하지 않아야 한다.** 판별은 tmux가 주입한
# SESSION_CANVAS_NODE_ID 환경변수로 한다 (SPEC 5.3).
#
# 외부 의존성 없음(jq 금지). stdin JSON을 그대로 저장하고 파싱은 앱이 한다.
# 항상 exit 0, stdout 출력 없음 — Claude Code 동작에 절대 영향을 주지 않는다.
id="$SESSION_CANVAS_NODE_ID"
[ -z "$id" ] && exit 0
case "$id" in *[!A-Za-z0-9_-]*) exit 0 ;; esac   # 경로 조작 방지
dir="$HOME/.session-canvas/status"
mkdir -p "$dir" 2>/dev/null || exit 0
tmp="$(mktemp "$dir/.tmp.XXXXXX" 2>/dev/null)" || exit 0
cat > "$tmp" 2>/dev/null
mv -f "$tmp" "$dir/$id.json" 2>/dev/null
exit 0
