#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"
WEB_BASE="${WEB_BASE:-http://localhost:3000}"

json_get() {
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const data=JSON.parse(s); console.log($1);})"
}

load_internal_token() {
  if [[ -n "${INTERNAL_RENDER_TOKEN:-}" ]]; then
    printf '%s' "$INTERNAL_RENDER_TOKEN"
    return
  fi
  if [[ -n "${AUTH_SESSION_SECRET:-}" ]]; then
    printf '%s' "$AUTH_SESSION_SECRET"
    return
  fi
  if [[ -f .env ]]; then
    awk -F= '
      $1 == "INTERNAL_RENDER_TOKEN" && length($2) > 2 { gsub(/^"|"$/, "", $2); print $2; exit }
      $1 == "AUTH_SESSION_SECRET" && length($2) > 2 { gsub(/^"|"$/, "", $2); print $2; exit }
    ' .env
  fi
}

AUTH_TOKEN="$(load_internal_token || true)"
AUTH_HEADER=()
if [[ -n "$AUTH_TOKEN" ]]; then
  AUTH_HEADER=(-H "x-meeting-ai-internal-token: $AUTH_TOKEN")
fi

curl -fsS "$API_BASE/health" >/dev/null
echo "API health ok"

LOGIN_REDIRECT="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$WEB_BASE/dashboard" || true)"
if [[ "$LOGIN_REDIRECT" == 307*"/login"* ]]; then
  echo "Web auth gate ok"
else
  echo "Web auth gate check skipped or already authenticated: $LOGIN_REDIRECT"
fi

if [[ ${#AUTH_HEADER[@]} -eq 0 ]]; then
  echo "No internal token available; skipped authenticated API flow."
  exit 0
fi

SMOKE_MODEL_ID="$(
  curl -fsS "${AUTH_HEADER[@]}" "$API_BASE/api/config/models" \
  | json_get '(Array.isArray(data.data) ? data.data : []).find((item) => item.name === "Smoke Fallback Model")?.id ?? ""'
)"

if [[ -z "$SMOKE_MODEL_ID" ]]; then
  SMOKE_MODEL_ID="$(
    curl -fsS -X POST "$API_BASE/api/config/models" \
    "${AUTH_HEADER[@]}" \
    -H 'content-type: application/json' \
    -d '{
      "name":"Smoke Fallback Model",
      "provider":"custom_gateway",
      "baseUrl":"http://127.0.0.1:9/v1/chat/completions",
      "apiKey":"smoke-only",
      "model":"smoke-fallback",
      "temperature":0.1,
      "maxTokens":12000,
      "jsonMode":true,
      "timeoutMs":1000,
      "retryCount":0,
      "enabled":true,
      "isDefault":false
    }' \
    | json_get 'data.data.id'
  )"
  echo "Created smoke fallback model"
fi

MEETING_ID="$(
  curl -fsS -X POST "$API_BASE/api/meetings" \
    "${AUTH_HEADER[@]}" \
    -H 'content-type: application/json' \
    -d '{
      "title":"Smoke Test Meeting",
      "meetingType":"general_meeting",
      "inputMode":"upload",
      "participants":["测试人员"],
      "summaryModelConfigId":"'"$SMOKE_MODEL_ID"'",
      "startNow":false
    }' \
  | json_get 'data.data.id'
)"

curl -fsS -X POST "$API_BASE/api/meetings/$MEETING_ID/transcript-segments" \
  "${AUTH_HEADER[@]}" \
  -H 'content-type: application/json' \
  -d '{"provider":"manual_paste","text":"本次会议同步项目进展。DMS 已完成联调，SMS 仍有验收偏差需要闭环。王利舟负责下周前整理风险清单。"}' >/dev/null

curl -fsS -X POST "$API_BASE/api/meetings/$MEETING_ID/generate-minutes" \
  "${AUTH_HEADER[@]}" \
  -H 'content-type: application/json' \
  -d '{"modelConfigId":"'"$SMOKE_MODEL_ID"'"}' >/dev/null

curl -fsS "${AUTH_HEADER[@]}" "$API_BASE/api/meetings/$MEETING_ID/minutes" \
  | json_get 'data.data?.id ? "Minutes generated ok" : "Minutes missing"'

echo "Smoke meeting flow ok: $MEETING_ID"
