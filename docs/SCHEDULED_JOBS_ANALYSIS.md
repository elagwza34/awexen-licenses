# Scheduled jobs analysis

## The four jobs, verified

`license-scheduler.service.ts`

| # | Schedule | Method | Purpose | Throws on failure |
|---|---|---|---|---|
| 1 | `EVERY_HOUR` | `reconcileLicenseStatuses` | `statusService.reconcileAllLicenses()` | **yes** (rethrows) |
| 2 | `*/15 * * * *` | `refreshLicensingSettings` | re-read `license.*` settings | **no** (logs only) |
| 3 | `10 1 * * *` | `queueExpiryNotifications` | write `LICENSE_EXPIRING` notifications | **yes** |
| 4 | `40 1 * * *` | `auditRecentTransitions` | audit licences changed in last 24 h | **yes** |

Note the deliberate inconsistency: job 2 swallows its errors because a stale
setting must not abort the run, while the other three rethrow so the failure is
visible. Reproduce this per-job, not uniformly.

## Leader election — Postgres advisory lock

`scheduler-lock.service.ts`

| Property | Value |
|---|---|
| Key | `0x4c494345` = `1280658757` (ASCII `"LICE"`) |
| Function | `pg_try_advisory_lock(bigint)` — **session-scoped** |
| Acquired | once at module init |
| Released | at shutdown, only if held |
| Failure at boot | logged; instance serves traffic but runs **no** jobs |

```sql
SELECT pg_try_advisory_lock(1280658757::bigint);
SELECT pg_advisory_unlock(1280658757::bigint);
```

The session-scoped variant is used rather than the transaction-scoped one
because cron ticks are independent; the lock is taken at boot and released at
shutdown (`:19-21`).

Losing the lock at boot is non-fatal by design (`:66-70`): an instance that
cannot reach the database must still serve API traffic. It simply does not
schedule.

`assertLeader()` throws **503** for manual triggers, so `/scheduler/run` on a
non-leader returns 503 rather than duplicating work.

**Laravel port:** `Cache::lock()` is *not* equivalent — it is a different
mechanism. Reproduce with a real `pg_try_advisory_lock` on a **dedicated,
persistent PDO connection**, because the lock dies with the session. Do not use
the standard request-scoped connection, or the lock will release immediately
and every instance will think it is the leader.

The brief's "no application-level locks" instruction is satisfied by using the
actual Postgres advisory lock.

## Idempotence

Every job is written to be safe to run twice (`:10-16`). That is a backstop,
**not** permission to run concurrently — two interleaved writers still corrupt
state, which is why the advisory lock remains necessary.

Job 3 dedupes with a natural key: it reads today's `LICENSE_EXPIRING`
notifications, collects `payload.licenceId` into a `Set`, and skips those ids.
One notification per licence per day.

Job 4 is capped at `take: 200` rows.

## Laravel mapping

| Nest | Laravel |
|---|---|
| `@Cron('10 1 * * *')` | `->cron('10 1 * * *')` in `routes/console.php` or `Console\Kernel` |
| `EVERY_HOUR` | `->hourly()` |
| `*/15 * * * *` | `->everyFifteenMinutes()` |
| `@Cron` decorator | schedule entries, run by `schedule:run` |
| `SchedulerLockService` | custom `PostgresAdvisoryLock` service |
| `assertLeader()` | `abort(503)` / `ServiceUnavailableException` |

Production cron:

```cron
* * * * * cd /var/www/api && php artisan schedule:run >> /dev/null 2>&1
```

`schedule:run` is sufficient — none of these jobs need a resident worker, so
**no queue is required**. `Notification` is an outbox table; delivery is not
implemented anywhere in the codebase.

## On switching to Laravel

`schedule:run` does not hold a connection open, so the boot-once
session-scoped advisory lock must be re-acquired **per tick**, not held for the
life of the process. Concretely: open a dedicated connection, take the lock,
run the job, release, close. A long-lived lock across invocations is impossible
with cron and would need redesign.

## Porting checklist

- [ ] Lock key exactly `1280658757` (`0x4c494365`).
- [ ] `pg_try_advisory_lock` / `pg_advisory_unlock`, session-scoped semantics.
- [ ] Dedicated persistent connection, re-acquired per tick.
- [ ] Non-leader skips silently at `debug` level.
- [ ] `/scheduler/run` returns 503 on a non-leader.
- [ ] Job 2 swallows errors; jobs 1, 3, 4 rethrow.
- [ ] All four schedules exact.
- [ ] Per-day notification dedupe preserved.
- [ ] `take: 200` cap on job 4.
- [ ] `schedule:run` cron entry documented.
- [ ] No queue introduced (none is needed).
