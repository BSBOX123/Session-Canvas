# Session Canvas

여러 개의 Claude Code 세션을 하나의 무한 캔버스 위에 터미널 노드로 배치하는 macOS 데스크톱 앱.

- 정본 명세: [SPEC.md](./SPEC.md)
- 진행 상황·삽질 기록: [HANDOVER.md](./HANDOVER.md)

## 요구 환경

- macOS 14+ (Apple Silicon), Node.js 20+
- tmux 3.3+ (`brew install tmux`) — 단계 3부터 필요
- Claude Code CLI

## 개발

```sh
npm install      # postinstall에서 node-pty를 Electron ABI로 재빌드한다
npm run dev      # 개발 모드 실행
npm test         # vitest
npm run lint     # ESLint
npm run typecheck
npm run build    # out/ 에 빌드

npm run verify:renderer   # 개발 앱을 띄워 렌더러를 자동 점검하고 종료 (SPEC 14.3)
```
