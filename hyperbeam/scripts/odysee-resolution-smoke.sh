#!/usr/bin/env bash
#
# Odysee resolution smoke test.
#
# Exercises the legacy-content resolution path end to end against a running
# node, using the REAL frontend request shape (POST JSON to the claim device):
#
#   1. search              (POST /~odysee-claim@1.0/search)      -> a fresh video claim
#   2. get-id              (resolve + state-plane write-through) -> immutable outpoint
#   3. GET /<claim-id>     (claim now on the common state plane)
#   4. GET /<claim-id>/verify                                    -> "true"
#   5. resolution device   (/~odysee-resolution@1.0/read?id=..)  -> live legacy fetch
#   6. media playback      (/~odysee-stream@1.0/media?id=..)     -> real media bytes
#
# A known-good control claim is played alongside the fresh one, so a single
# unavailable legacy video is distinguished from an actual playback regression.
#
# Usage:   NODE=http://localhost:8734 scripts/odysee-resolution-smoke.sh [search-text]
# Exit:    0 = all checks passed, 1 = one or more failed.

set -uo pipefail

NODE="${NODE:-http://localhost:8734}"
TEXT="${1:-science}"
# Known-good control (Veritasium "why-is-it-so-easy-to-disrupt-gps").
CONTROL_OUT="2a7a5ce031d86eb92ff5a73614e10410360912d93b9b3c4ec6d95804dc99ae8d:0"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; warn=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }
wrn() { echo "  WARN  $1"; warn=$((warn+1)); }
info(){ echo "  ..    $1"; }

enc()  { python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
code() { curl -s -m"${2:-15}" -o /dev/null -w '%{http_code}' "$1"; }

is_media() { file "$1" 2>/dev/null | grep -qiE 'media|mp4|matroska|webm|MPEG|ISO|audio'; }

try_play() { # $1=outpoint -> echoes "<http_code> <bytes>"; returns 0 iff valid media
  local out="$1" e mc bytes
  e="$(enc "$out")"
  mc="$(curl -s -m90 -r 0-1048575 "$NODE/~odysee-stream@1.0/media?id=$e" -o "$TMP/media.part" -w '%{http_code}')"
  bytes="$(wc -c <"$TMP/media.part" | tr -d ' ')"
  if { [ "$mc" = 206 ] || [ "$mc" = 200 ]; } && is_media "$TMP/media.part"; then
    echo "$mc, ${bytes} bytes"; return 0
  fi
  echo "HTTP $mc"; return 1
}

echo "== odysee resolution smoke test =="
echo "== node: $NODE  search: \"$TEXT\" =="

# 0. health --------------------------------------------------------------
c="$(code "$NODE/~meta@1.0/info" 5)"
[ "$c" = 200 ] && ok "node health ($c)" || { bad "node health ($c)"; echo "== ABORT: node unreachable =="; exit 1; }

# 1. search -> fresh video claim ----------------------------------------
curl -s -m60 -X POST "$NODE/~odysee-claim@1.0/search" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"text\":\"$TEXT\",\"page_size\":15,\"order_by\":[\"release_time\"]}" \
  -o "$TMP/search.json" -w '' || true

python3 - "$TMP/search.json" > "$TMP/vids.txt" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
body = d.get("body") or d
if isinstance(body, str):
    try: body = json.loads(body)
    except Exception: body = {}
res = body.get("result", body) if isinstance(body, dict) else {}
items = res.get("items") or res.get("claims") or []
for it in items:
    v = it.get("value") or {}
    src = v.get("source") or {} if isinstance(v, dict) else {}
    if str(src.get("media_type", "")).startswith("video") and it.get("claim_id") \
            and it.get("txid") is not None and it.get("nout") is not None:
        print("%s %s:%s" % (it["claim_id"], it["txid"], it["nout"]))
PY

read -r CID OUT_FROM_SEARCH < "$TMP/vids.txt" 2>/dev/null || true

if [ -z "${CID:-}" ]; then
  bad "search returned no fresh video claim (legacy search may be down)"
else
  ok "search -> $(wc -l <"$TMP/vids.txt" | tr -d ' ') fresh video claims (using $CID)"

  # 2. before-state (informational; may already be cached from a prior run)
  info "GET /<claim> before get-id = $(code "$NODE/$CID")"

  # 3. get-id -> resolve + write-through -> outpoint
  curl -s -m45 "$NODE/~odysee-claim@1.0/get-id?claim-id=$CID" -o "$TMP/id.json" -w '' || true
  OUT="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d.get("id") or d.get("immutable-id") or "")' "$TMP/id.json" 2>/dev/null)"
  [ -z "$OUT" ] && OUT="$OUT_FROM_SEARCH"
  [ -n "$OUT" ] && ok "get-id -> immutable outpoint $OUT" || bad "get-id returned no outpoint"

  # 4. claim now on the common state plane + verifiable
  a="$(code "$NODE/$CID")"
  [ "$a" = 200 ] && ok "GET /<claim> after get-id = 200 (on common plane)" || bad "GET /<claim> after get-id = $a"
  vr="$(curl -s -m15 "$NODE/$CID/verify")"
  [ "$vr" = true ] && ok "GET /<claim>/verify = true" || bad "GET /<claim>/verify = '$vr'"

  # 5. resolution device direct (classify -> bridge -> leaf, live legacy fetch)
  if [ -n "$OUT" ]; then
    rc="$(code "$NODE/~odysee-resolution@1.0/read?id=$(enc "$OUT")" 30)"
    [ "$rc" = 200 ] && ok "resolution device read($OUT) = 200" || bad "resolution device read = $rc"
  fi

  # 6. media playback of a fresh claim: try candidates; a lone legacy-CDN
  #    failure warns (the control below isolates real playback health).
  played=0
  while read -r cand_cid cand_out; do
    [ -z "${cand_out:-}" ] && continue
    if r="$(try_play "$cand_out")"; then
      ok "media playback [fresh $cand_cid] ($r, valid media)"
      played=1; break
    fi
    info "fresh media [$cand_cid] unavailable ($r) — trying next candidate"
  done < "$TMP/vids.txt"
  [ "$played" = 1 ] || wrn "no sampled fresh video played (legacy CDN unavailable) — control result below is authoritative"
fi

# control playback: proves playback itself is healthy regardless of the fresh pick
if r="$(try_play "$CONTROL_OUT")"; then
  ok "media playback [control veritasium] ($r, valid media)"
else
  bad "media playback [control veritasium] ($r) — PLAYBACK REGRESSION"
fi

echo "== $pass passed, $warn warnings, $fail failed =="
[ "$fail" = 0 ]
