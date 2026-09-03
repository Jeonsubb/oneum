#!/usr/bin/env bash
# 온음 데모 전체 기동 — 파인튜닝 모델까지 붙인 상태로 실기기 시연
#   ./run-demo.sh          기존에 떠 있던 것을 정리하고 새로 띄운다
#   ./run-demo.sh --stop   전부 종료만 한다
#
# 이전 판은 "포트가 살아 있으면 준비 완료"로 판정했는데, 그러면 예전 프로세스가
# 남아 있을 때 새 서버가 bind 실패로 죽어도 성공한 것처럼 보였다.
# 그래서 지금은 반드시 먼저 정리하고, 우리가 띄운 PID가 살아 있는지로 판정한다.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ASR_PORT=8020
API_PORT=8010
EXPO_PORT=8084

free_port() {
  local port=$1 pids
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  포트 $port 를 쓰던 프로세스 정리: $(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

stop_all() {
  echo "정리 중…"
  for p in "$ASR_PORT" "$API_PORT" "$EXPO_PORT"; do free_port "$p"; done
}

if [ "${1:-}" = "--stop" ]; then stop_all; echo "종료 완료"; exit 0; fi

echo "▸ 기존 프로세스 정리"
stop_all

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if [ -z "$IP" ]; then echo "✗ LAN IP를 찾지 못했습니다. 와이파이 연결을 확인하세요"; exit 1; fi
echo "▸ 개발 PC LAN IP: $IP  — 폰이 같은 와이파이에 있어야 합니다"
echo "EXPO_PUBLIC_API_URL=http://$IP:$API_PORT" > "$ROOT/mobile/.env"

trap stop_all EXIT INT TERM

# 1) 파인튜닝 ASR — 모델 적재에 몇 초 걸린다
( cd "$ROOT/../asr-poc" && exec uv run uvicorn serve:app --port "$ASR_PORT" ) &
ASR_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$ASR_PID" 2>/dev/null || { echo "✗ ASR 서버가 죽었습니다 (위 로그 확인)"; exit 1; }
  curl -sf "http://localhost:$ASR_PORT/healthz" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:$ASR_PORT/healthz" >/dev/null || { echo "✗ ASR 응답 없음"; exit 1; }
echo "✓ 파인튜닝 ASR ($ASR_PORT) — $(curl -s "http://localhost:$ASR_PORT/healthz")"

# 2) 온음 백엔드 — 0.0.0.0 으로 열어야 폰에서 붙는다
( cd "$ROOT/backend" && ASR_PROVIDER=local exec uv run uvicorn main:app --host 0.0.0.0 --port "$API_PORT" ) &
API_PID=$!
for _ in $(seq 1 40); do
  kill -0 "$API_PID" 2>/dev/null || { echo "✗ 백엔드가 죽었습니다 (위 로그 확인)"; exit 1; }
  curl -sf "http://localhost:$API_PORT/healthz" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:$API_PORT/healthz" >/dev/null || { echo "✗ 백엔드 응답 없음"; exit 1; }
echo "✓ 백엔드 ($API_PORT) — $(curl -s "http://localhost:$API_PORT/healthz")"

# 폰에서 실제로 닿는지까지 확인한다. 여기서 실패하면 방화벽이나 와이파이 문제다.
curl -sf --max-time 3 "http://$IP:$API_PORT/healthz" >/dev/null \
  && echo "✓ 폰에서 접속 가능 (http://$IP:$API_PORT)" \
  || echo "⚠ LAN 주소로 접속되지 않습니다 — 맥 방화벽 설정을 확인하세요"

# 3) 앱 — Ctrl+C 하면 trap 이 위 두 개도 함께 정리한다
echo "▸ Expo 시작 (Ctrl+C 로 전부 종료)"
cd "$ROOT/mobile" && npx expo start --port "$EXPO_PORT"
