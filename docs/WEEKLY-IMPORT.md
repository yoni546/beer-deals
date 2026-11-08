# The weekly import of the three blocked chains

Victory, Mahsanei HaShuk and Hatzi Hinam publish their price files under the
same law as everyone else, but their servers refuse addresses outside Israel.
GitHub's runners are outside Israel, so the nightly workflow imports the other
fourteen chains and silently skips these three.

Nothing breaks when that happens. `close_missing_promotions` only closes
promotions on branches that were actually read, so a chain that was not read
keeps every offer it had. The offers simply reach their own end dates and
expire, and nothing puts new ones in their place. Measured on 2026-10-31: the
first import of these three from a machine in Israel took the catalogue from
346 live offers to 474, of which Victory alone was 91 — the largest single
chain in the app.

So the import has to run from a machine in Israel, on a schedule, and the
owner's PC is the machine.

## What is registered

A Windows scheduled task, **"Beer Deals - weekly import of the three blocked
chains"**, every Sunday at 09:00. It runs `scripts/weekly-blocked-chains.ps1`,
which is the same two commands that were run by hand on 2026-10-31:

```
node scripts/ingest/scan.mjs --publishers victory,mahsanei,hatzi-hinam
node scripts/ingest/run.mjs  --target production --confirm-ref <ref> --publishers victory,mahsanei,hatzi-hinam
```

## Two triggers, and the guard that makes the second one safe

The task fires **every Sunday at 09:00 and again ten minutes after every
logon**, and the script decides which of those is a real import.

A weekly trigger alone does not survive a laptop. On 8 November the 09:00
occurrence never ran — the machine was off — and Windows moved straight on to
the 15th rather than catching up, so a whole week of these three chains would
have gone unrefreshed. Task history is off on this machine, so why "start when
available" did not catch up cannot be read back; the answer was to stop relying
on it being right.

So the script carries its own clock. Before it does anything it looks for the
newest log that ends in `done`, and if that run finished less than
`-MaxAgeDays` ago (default **6**) it writes `skipped` and exits 0. Six days,
not seven, so the weekly import is never the one skipped — only the extra
attempts the logon trigger makes around it. `-Force` imports regardless.

Now the machine can be off on any given Sunday and the next logon picks it up,
while a machine that is rebooted twice a day still imports once a week.

Settings that matter, and why:

- **Start when available**, still, as a third chance.
- **Only when a network is available**, and a **one-hour limit**. A real run
  takes four to seven minutes; an hour means a hung fetch cannot sit there
  until Sunday.
- **Do not start a new instance** if one is somehow still running.
- **Allowed to start, and to keep running, on battery.** Not the default: a new
  task refuses both, and the very first trigger of this one sat in `Queued` for
  that reason. The machine is a laptop, so that is its normal state.
- **Runs as the logged-in user, without stored credentials.** The task needs
  `.env.production.local`, which lives in the checkout and is git-ignored. It
  therefore runs only while the owner is logged in — which is the same
  condition as the machine being on.

Task history is **disabled** on this machine, which is Windows' default and
which cost a diagnosis on 8 November. Turning it on needs an administrator:

```powershell
wevtutil set-log Microsoft-Windows-TaskScheduler/Operational /enabled:true
```

## Reading what it did

`logs/weekly-blocked-chains/<date>.log` in the checkout (git-ignored, the last
twelve kept). A good run ends with a JSON line whose `errors` is `0`:

```json
{"seconds":228,"branchesWritten":150,"regular":{"accepted":7544,...},"errors":0}
```

A skipped run ends with `skipped` and is not a failure. A failed run ends with
a line beginning `FAILED:`, and the task's Last Run Result is non-zero.

## Running it by hand

Task Scheduler → Task Scheduler Library → right-click the task → **Run**. That
obeys the six-day guard, so soon after a good run it will only say `skipped`.
To import anyway:

```powershell
& "C:\Users\yoni1\Desktop\beer-deals\scripts\weekly-blocked-chains.ps1" -Force
```

**A killed write blocks the next four hours.** `start_ingestion_run` answers
"already imported" for a run of the same files that is still `running`, and
0067 only marks such a run failed once it is four hours old. So after a run
that died part-way, an immediate retry writes nothing and says it was already
done. Wait out the four hours, or roll the dead runs back (below) first. Seen
on 8 November, when the write was killed by the stderr fault this change fixes.

## Undoing an import

Every write is one ingestion run, and a run can be taken back whole:

```sql
select rollback_ingestion_run('<run id>', 'why');
```

The run ids are in the log, and in `ingestion_runs`.

## Turning it off

```powershell
Unregister-ScheduledTask -TaskName "Beer Deals - weekly import of the three blocked chains" -Confirm:$false
```

The three chains then stop being refreshed; nothing else changes.
