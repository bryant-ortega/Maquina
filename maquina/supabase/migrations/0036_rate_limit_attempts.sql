-- Migration 0036 — rate_limit_attempts + check_rate_limit().
--
-- Shared rate-limiting primitive for src/lib/rate-limit.ts. No
-- Redis/Upstash/KV is configured for this app (checked package.json —
-- nothing there, and no matching env vars), so this reuses the
-- existing Supabase project instead of adding new infra, same as
-- every other service-role table in this codebase.
--
-- One row per rate-limit "bucket" (e.g. "login:ip:1.2.3.4" or
-- "login:email:foo@bar.com"). check_rate_limit() does an atomic
-- upsert-and-check in a single statement — the UNIQUE key + row-level
-- lock means concurrent requests against the same bucket serialize
-- correctly instead of racing past each other.
--
-- Fixed-window, not sliding-window: a caller can land up to 2x max
-- attempts across a window boundary. That's an accepted tradeoff for
-- a single-statement, race-safe implementation — good enough for
-- "max 5 attempts per 15 min" login throttling, not meant to be exact
-- to the millisecond.
--
-- RLS enabled with zero policies — same isolation pattern as
-- ofrendas_vendor_applications (0032/0033): only the service-role key
-- can touch this table, via checkRateLimit() in rate-limit.ts calling
-- the check_rate_limit() RPC (SECURITY DEFINER not needed — the RPC
-- itself only runs under the service-role connection).

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;
-- No policies added — deliberate default-deny for anon/authenticated.

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_attempts integer,
  p_window_seconds integer
) RETURNS TABLE(
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count       integer;
  v_window_start timestamptz;
  v_now         timestamptz := clock_timestamp();
BEGIN
  INSERT INTO rate_limit_attempts AS rl (key, count, window_start)
  VALUES (p_key, 1, v_now)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rl.window_start <= v_now - make_interval(secs => p_window_seconds)
        THEN 1
      ELSE rl.count + 1
    END,
    window_start = CASE
      WHEN rl.window_start <= v_now - make_interval(secs => p_window_seconds)
        THEN v_now
      ELSE rl.window_start
    END
  RETURNING rl.count, rl.window_start INTO v_count, v_window_start;

  -- Opportunistic cleanup of long-stale buckets (~1% of calls) so the
  -- table doesn't grow unbounded — no separate cron job needed for a
  -- table this cheap to prune.
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_attempts
    WHERE window_start < v_now - interval '1 day';
  END IF;

  RETURN QUERY SELECT
    v_count <= p_max_attempts,
    GREATEST(p_max_attempts - v_count, 0),
    GREATEST(
      EXTRACT(
        EPOCH FROM (
          v_window_start + make_interval(secs => p_window_seconds) - v_now
        )
      )::integer,
      0
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
