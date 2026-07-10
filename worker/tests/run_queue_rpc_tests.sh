#!/usr/bin/env bash
# Real verification of the worker queue migration against a local PostgreSQL
# cluster (no Supabase, no Docker needed). Boots an ephemeral cluster, loads
# the prerequisite stubs + the REAL migration SQL, and exercises atomic
# claiming, lease expiry/reap, heartbeats, cancellation, retry, attempt caps,
# privilege isolation, and transcript idempotency.
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATION="$REPO/supabase/migrations/202607100001_video_worker_queue.sql"
WORK="$(mktemp -d)"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
DB=vidora_test
export PGHOST="$SOCK"
export PGDATABASE="$DB"

pass=0; fail=0
ok()   { echo "PASS: $1"; pass=$((pass+1)); }
bad()  { echo "FAIL: $1 (expected=[$2] actual=[$3])"; fail=$((fail+1)); }
eq()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2" "$3"; }
q()    { psql -qtAX -v ON_ERROR_STOP=1 -c "$1" 2>&1 | tr -d '\n\r'; }
qraw() { psql -qtAX -c "$1" 2>&1; }

# Postgres refuses to run as root; use a dedicated unprivileged user when we
# are root, otherwise run directly.
RUN=""
if [ "$(id -u)" = "0" ]; then
  id pgrunner >/dev/null 2>&1 || useradd -m pgrunner >/dev/null 2>&1
  chown -R pgrunner "$WORK"
  chmod 777 "$WORK"
  RUN="runuser -u pgrunner --"
fi

cleanup() { $RUN "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$SOCK"; [ -n "$RUN" ] && chown pgrunner "$SOCK"
$RUN "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
$RUN "$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1 || { echo "pg start failed"; exit 1; }
export PGUSER=postgres
$RUN "$PGBIN/createdb" -h "$SOCK" "$DB" 2>/dev/null

SUBTITLE_MIGRATION="$REPO/supabase/migrations/202607110001_subtitle_artifacts.sql"
psql -qX -v ON_ERROR_STOP=1 -f "$HERE/sql/00_prereqs.sql" >/dev/null || { echo "prereqs load failed"; exit 1; }
psql -qX -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null || { echo "migration load failed"; exit 1; }
psql -qX -v ON_ERROR_STOP=1 -f "$SUBTITLE_MIGRATION" >/dev/null || { echo "subtitle migration load failed"; exit 1; }
ok "migrations + prereqs load cleanly into Postgres"

U=11111111-1111-1111-1111-111111111111

seed_job() { # seed_job <video_status> <job_status> <attempt> <max> <lease_offset_secs|NULL> <retryable> -> prints job_id
  local vst="$1" jst="$2" att="$3" mx="$4" lease="$5" retry="$6"
  local vid jid lease_expr
  vid=$(q "insert into public.videos(user_id,source_type,status,storage_key) values('$U','upload','$vst','k') returning id;")
  if [ "$lease" = "NULL" ]; then lease_expr="null"; else lease_expr="now() + interval '$lease seconds'"; fi
  jid=$(q "insert into public.video_jobs(video_id,user_id,stage,status,attempt,max_attempts,worker_id,lease_expires_at,retryable)
           values('$vid','$U','$vst','$jst',$att,$mx, case when '$jst'='running' then 'crashed-w' else null end, $lease_expr, $retry) returning id;")
  echo "$vid|$jid"
}

# ---- 1. Atomic claim picks the oldest queued job and leases it -------------
IDS=$(seed_job queued queued 1 3 NULL true); VID=${IDS%|*}; JID=${IDS#*|}
CLAIM=$(q "select (claim_next_video_job('worker-A',120)).id;")
eq "claim returns the queued job" "$JID" "$CLAIM"
eq "claimed job is now running" "running" "$(q "select status from public.video_jobs where id='$JID';")"
eq "claimed job records worker id" "worker-A" "$(q "select worker_id from public.video_jobs where id='$JID';")"
eq "claim sets a future lease" "t" "$(q "select (lease_expires_at > now()) from public.video_jobs where id='$JID';")"
eq "claim moves video to acquiring_source" "acquiring_source" "$(q "select status from public.videos where id='$VID';")"
eq "second claim finds nothing (only job now running)" "" "$(q "select (claim_next_video_job('worker-B',120)).id;")"

# ---- 2. TRUE concurrency: two workers, one queued job, exactly one wins ----
race_fail=0
for i in 1 2 3 4 5; do
  IDS=$(seed_job queued queued 1 3 NULL true); RJID=${IDS#*|}
  r1="$WORK/r1.$i"; r2="$WORK/r2.$i"
  psql -qtAX -c "select (claim_next_video_job('race-1',120)).id;" > "$r1" 2>/dev/null &
  psql -qtAX -c "select (claim_next_video_job('race-2',120)).id;" > "$r2" 2>/dev/null &
  wait
  got=$(cat "$r1" "$r2" | tr -d '[:space:]')
  winners=$(cat "$r1" "$r2" | grep -c "$RJID")
  [ "$winners" = "1" ] || { race_fail=1; echo "  race $i: winners=$winners got=[$got]"; }
done
eq "concurrent claims: exactly one worker wins every race" "0" "$race_fail"

# ---- 3. Cancelled video's queued job is never claimed ----------------------
IDS=$(seed_job queued queued 1 3 NULL true); CVID=${IDS%|*}
q "update public.videos set status='cancelled' where id='$CVID';" >/dev/null
eq "cancelled video's job is not claimable" "" "$(q "select (claim_next_video_job('worker-C',120)).id;")"

# ---- 4. Expired lease, attempts remaining -> re-queued with attempt++ ------
IDS=$(seed_job acquiring_source running 1 3 -30 true); EVID=${IDS%|*}; EJID=${IDS#*|}
eq "reaper acts on one expired job" "1" "$(q "select public.release_expired_video_jobs();")"
eq "expired job re-queued" "queued" "$(q "select status from public.video_jobs where id='$EJID';")"
eq "expired job attempt incremented" "2" "$(q "select attempt from public.video_jobs where id='$EJID';")"
eq "expired job lease cleared" "" "$(q "select coalesce(lease_expires_at::text,'') from public.video_jobs where id='$EJID';")"
eq "expired job video back to queued" "queued" "$(q "select status from public.videos where id='$EVID';")"

# ---- 5. Expired lease at attempt cap -> permanent JOB_TIMEOUT --------------
IDS=$(seed_job transcribing running 3 3 -30 true); TVID=${IDS%|*}; TJID=${IDS#*|}
q "select public.release_expired_video_jobs();" >/dev/null
eq "exhausted expired job fails" "failed" "$(q "select status from public.video_jobs where id='$TJID';")"
eq "exhausted expired job code JOB_TIMEOUT" "JOB_TIMEOUT" "$(q "select error_code from public.video_jobs where id='$TJID';")"
eq "exhausted expired video failed" "failed" "$(q "select status from public.videos where id='$TVID';")"
eq "exhausted expired video has Persian failure" "t" "$(q "select (failure_message_fa is not null) from public.videos where id='$TVID';")"

# ---- 6. Expired lease but video cancelled -> job cancelled, not failed -----
IDS=$(seed_job transcribing running 1 3 -30 true); XVID=${IDS%|*}; XJID=${IDS#*|}
q "update public.videos set status='cancelled' where id='$XVID';" >/dev/null
q "select public.release_expired_video_jobs();" >/dev/null
eq "reaped cancelled-video job is cancelled" "cancelled" "$(q "select status from public.video_jobs where id='$XJID';")"

# ---- 7. Heartbeat ownership + progress + cancel detection -----------------
IDS=$(seed_job acquiring_source running 1 3 60 true); HVID=${IDS%|*}; HJID=${IDS#*|}
q "update public.video_jobs set worker_id='hb-worker' where id='$HJID';" >/dev/null
eq "heartbeat from wrong worker denied" "f" "$(q "select ok from public.heartbeat_video_job('$HJID','other',120,5,10,50);")"
eq "heartbeat from owner ok" "t" "$(q "select ok from public.heartbeat_video_job('$HJID','hb-worker',120,5,10,50);")"
eq "heartbeat wrote progress_total" "10" "$(q "select progress_total from public.video_jobs where id='$HJID';")"
q "update public.videos set status='cancelled' where id='$HVID';" >/dev/null
eq "heartbeat detects cancellation" "t" "$(q "select cancelled from public.heartbeat_video_job('$HJID','hb-worker',120,null,null,null);")"
eq "heartbeat-detected cancel finalizes job" "cancelled" "$(q "select status from public.video_jobs where id='$HJID';")"

# ---- 8. Stage advance + phase completion ----------------------------------
IDS=$(seed_job acquiring_source running 1 3 60 true); SVID=${IDS%|*}; SJID=${IDS#*|}
q "update public.video_jobs set worker_id='st-worker' where id='$SJID';" >/dev/null
eq "stage advance ok" "t" "$(q "select ok from public.complete_video_job_stage('$SJID','st-worker','transcribing',120,null,null,30);")"
eq "video advanced to transcribing" "transcribing" "$(q "select status from public.videos where id='$SVID';")"
eq "phase complete marks job completed" "t" "$(q "select ok from public.complete_video_job('$SJID','st-worker','translating');")"
eq "completed job status" "completed" "$(q "select status from public.video_jobs where id='$SJID';")"
eq "video at translating after phase" "translating" "$(q "select status from public.videos where id='$SVID';")"

# ---- 9. fail: retryable under cap re-queues; then permanent at cap ---------
IDS=$(seed_job transcribing running 1 3 60 true); FVID=${IDS%|*}; FJID=${IDS#*|}
q "update public.video_jobs set worker_id='f-worker' where id='$FJID';" >/dev/null
eq "retryable fail re-queues" "t" "$(q "select requeued from public.fail_video_job('$FJID','f-worker','STT_RATE_LIMITED','429','خطا',true);")"
eq "retryable fail attempt++" "2" "$(q "select attempt from public.video_jobs where id='$FJID';")"
eq "retryable fail video back to queued" "queued" "$(q "select status from public.videos where id='$FVID';")"
# re-run, now at attempt 2 -> claim again, fail non-retryable -> permanent
q "update public.video_jobs set status='running', worker_id='f-worker', lease_expires_at=now()+interval '60 seconds' where id='$FJID';" >/dev/null
eq "non-retryable fail is permanent" "t" "$(q "select failed from public.fail_video_job('$FJID','f-worker','MEDIA_NO_AUDIO','no audio','بدون صدا',false);")"
eq "permanent fail sets video failed" "failed" "$(q "select status from public.videos where id='$FVID';")"
eq "permanent fail persists Persian message" "بدون صدا" "$(q "select failure_message_fa from public.videos where id='$FVID';")"

# ---- 10. Privilege isolation: clients cannot call worker RPCs --------------
DENY=$(psql -qtAX -c "set role authenticated; select public.claim_next_video_job('x',120);" 2>&1 | tr -d '\n')
eq "authenticated role denied claim" "denied" "$(echo "$DENY" | grep -qi 'permission denied' && echo denied || echo "$DENY")"
DENY2=$(psql -qtAX -c "set role anon; select public.release_expired_video_jobs();" 2>&1 | tr -d '\n')
eq "anon role denied reaper" "denied" "$(echo "$DENY2" | grep -qi 'permission denied' && echo denied || echo "$DENY2")"

# ---- 11. Transcript upsert idempotency (retry-safe, no dup rows) -----------
IDS=$(seed_job transcribing running 1 3 60 true); UVID=${IDS%|*}
SEG='[{"segment_index":0,"start_ms":0,"end_ms":1000,"source_text":"hello","confidence":0.9,"source_language":"en"},{"segment_index":1,"start_ms":1000,"end_ms":2000,"source_text":"world","source_language":"en"}]'
eq "upsert inserts 2 segments" "2" "$(q "select public.upsert_transcript_segments('$UVID','$SEG'::jsonb);")"
q "select public.upsert_transcript_segments('$UVID','$SEG'::jsonb);" >/dev/null
eq "re-upsert does not duplicate rows" "2" "$(q "select count(*) from public.transcript_segments where video_id='$UVID';")"
# 12. translations update existing, skip empty
TR='[{"segment_index":0,"translated_text_fa":"سلام"},{"segment_index":1,"translated_text_fa":""}]'
q "select public.update_transcript_translations('$UVID','$TR'::jsonb,'openai_compatible','qwen');" >/dev/null
eq "translation written for seg 0" "سلام" "$(q "select translated_text_fa from public.transcript_segments where video_id='$UVID' and segment_index=0;")"
eq "empty translation skipped for seg 1" "" "$(q "select coalesce(translated_text_fa,'') from public.transcript_segments where video_id='$UVID' and segment_index=1;")"
eq "translation provenance recorded" "qwen" "$(q "select translation_model from public.transcript_segments where video_id='$UVID' and segment_index=0;")"

# ---- 13. subtitle_artifacts: idempotent upsert + constraints + RLS ---------
IDS=$(seed_job translating completed 1 3 NULL true); SUBVID=${IDS%|*}
HASH1=abc123
up1=$(q "select status from public.upsert_subtitle_artifact('$SUBVID','fa','vtt','ready','$SUBVID/videos/$SUBVID/subtitles/$HASH1/fa.vtt','$HASH1','sub-v1',3,3,'[]'::jsonb,null,null);")
eq "subtitle upsert creates ready row" "ready" "$up1"
eq "one artifact row exists" "1" "$(q "select count(*) from public.subtitle_artifacts where video_id='$SUBVID' and format='vtt';")"
# re-upsert same format -> still one row (idempotent on unique video/lang/format)
q "select public.upsert_subtitle_artifact('$SUBVID','fa','vtt','ready','$SUBVID/videos/$SUBVID/subtitles/$HASH1/fa.vtt','$HASH1','sub-v1',3,3,'[]'::jsonb,null,null);" >/dev/null
eq "re-upsert does not duplicate artifact rows" "1" "$(q "select count(*) from public.subtitle_artifacts where video_id='$SUBVID' and format='vtt';")"
# srt is a separate row
q "select public.upsert_subtitle_artifact('$SUBVID','fa','srt','ready','$SUBVID/videos/$SUBVID/subtitles/$HASH1/fa.srt','$HASH1','sub-v1',3,3,'[]'::jsonb,null,null);" >/dev/null
eq "srt artifact is a distinct row" "2" "$(q "select count(*) from public.subtitle_artifacts where video_id='$SUBVID';")"
# a failed status must not clobber the ready storage_path/hash
q "select public.upsert_subtitle_artifact('$SUBVID','fa','vtt','failed',null,null,null,null,null,'[]'::jsonb,'SUBTITLE_STORAGE_FAILED','boom');" >/dev/null
eq "failed upsert preserves prior ready storage_path" "$SUBVID/videos/$SUBVID/subtitles/$HASH1/fa.vtt" "$(q "select storage_path from public.subtitle_artifacts where video_id='$SUBVID' and format='vtt';")"
eq "failed upsert records error_code" "SUBTITLE_STORAGE_FAILED" "$(q "select error_code from public.subtitle_artifacts where video_id='$SUBVID' and format='vtt';")"
# invalid format rejected by check constraint
badfmt=$(psql -qtAX -c "select public.upsert_subtitle_artifact('$SUBVID','fa','txt','ready',null,null,null,null,null,'[]'::jsonb,null,null);" 2>&1 | tr -d '\n')
eq "invalid format rejected" "rejected" "$(echo "$badfmt" | grep -qi 'violates check constraint\|invalid' && echo rejected || echo "$badfmt")"
# mark stale keeps a matching hash
q "select public.upsert_subtitle_artifact('$SUBVID','fa','vtt','ready','$SUBVID/videos/$SUBVID/subtitles/$HASH1/fa.vtt','$HASH1','sub-v1',3,3,'[]'::jsonb,null,null);" >/dev/null
q "select public.mark_subtitle_artifacts_stale('$SUBVID', 'differenthash');" >/dev/null
eq "mark_stale sets ready rows stale when hash differs" "stale" "$(q "select status from public.subtitle_artifacts where video_id='$SUBVID' and format='vtt';")"
# client roles cannot call the worker upsert
DENY3=$(psql -qtAX -c "set role authenticated; select public.upsert_subtitle_artifact('$SUBVID','fa','vtt','ready',null,null,null,null,null,'[]'::jsonb,null,null);" 2>&1 | tr -d '\n')
eq "authenticated role denied subtitle upsert" "denied" "$(echo "$DENY3" | grep -qi 'permission denied' && echo denied || echo "$DENY3")"
# owner (RLS) can read only own artifact metadata
OWN=$(q "select user_id from public.videos where id='$SUBVID';")
canread=$(psql -qtAX -c "set role authenticated; select set_config('app.current_user','$OWN',true); select count(*) from public.subtitle_artifacts where video_id='$SUBVID';" 2>&1 | tail -1 | tr -d '[:space:]')
eq "owner reads own artifact metadata via RLS" "2" "$canread"
otherread=$(psql -qtAX -c "set role authenticated; select set_config('app.current_user','22222222-2222-2222-2222-222222222222',true); select count(*) from public.subtitle_artifacts where video_id='$SUBVID';" 2>&1 | tail -1 | tr -d '[:space:]')
eq "another user cannot read artifact metadata" "0" "$otherread"

echo "---------------------------------------------"
echo "queue RPC tests: $pass passed, $fail failed"
[ "$fail" = "0" ]
