#!/usr/bin/env bash
# Send a Beds24 v2 sample webhook to the local dev server.
# Usage: bash scripts/dev/beds24-webhook-test.sh [sample-file]
# Example: bash scripts/dev/beds24-webhook-test.sh scripts/dev/beds24-webhook-sample.json
#
# Requirements:
#   - Next.js dev server running on localhost:3000 (npm run dev)
#   - BEDS24_WEBHOOK_SECRET env var set — must match the dev server. If the server has no secret
#     the webhook answers 503 {"error":"not_configured"} (fail-closed since 2026-11-13); a missing or
#     wrong secret answers 403 {"error":"forbidden"}.
#   - BEDS24_DEFAULT_ORGANIZATION_ID env var set to a valid org UUID
#
# The response JSON shows:
#   ok: true on success
#   reservationId: UUID of the upserted reservation
#   roomSync: { propertyId, roomId, roomStatus, skipped }
#     roomStatus will be "inactive" for webhook-synced rooms (no minimumStay in payload)
#     roomStatus becomes "active" only after inventory sync populates external_minimum_stay
#   inventorySync: { attempted, endpointTried, matchedRooms, updatedRooms, skipped }

SAMPLE="${1:-scripts/dev/beds24-webhook-sample.json}"
SECRET="${BEDS24_WEBHOOK_SECRET:-}"
URL="http://localhost:3000/api/beds24/webhook"

if [ -z "$SECRET" ]; then
  echo "[warn] BEDS24_WEBHOOK_SECRET is empty — sending without auth header."
  echo "[warn] Expected: 403 forbidden (server has a secret) or 503 not_configured (server has none). Nothing is stored."
  curl -s -X POST "$URL" \
    -H "Content-Type: application/json" \
    -w '\nHTTP %{http_code}\n' \
    -d @"$SAMPLE"
else
  curl -s -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-beds24-webhook-secret: $SECRET" \
    -d @"$SAMPLE" | jq .
fi
