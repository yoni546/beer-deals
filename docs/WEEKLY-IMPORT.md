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

Settings that matter, and why:

- **Start when available.** A weekly task on a desktop PC will be missed. This
  makes Windows run it the next time the machine is on rather than waiting a
  week.
- **Only when a network is available**, and a **one-hour limit**. The hand run
  took just under seven minutes; an hour means a hung fetch cannot sit there
  until Sunday.
- **Do not start a new instance** if one is somehow still running.
- **Allowed to start, and to keep running, on battery.** Not the default: a new task
  refuses both, and the first trigger of this one sat in `Queued` for that reason. The
  machine is a laptop, so that is its normal Sunday state.
- **Runs as the logged-in user, without stored credentials.** The task needs
  `.env.production.local`, which lives in the checkout and is git-ignored. It
  therefore runs only while the owner is logged in — which is the same
  condition as the machine being on.

## Reading what it did

`logs/weekly-blocked-chains/<date>.log` in the checkout (git-ignored, the last
twelve kept). A good run ends with a JSON line whose `errors` is `0`:

```json
{"seconds":228,"branchesWritten":150,"regular":{"accepted":7544,...},"errors":0}
```

A failed run ends with a line beginning `FAILED:` and the task's History tab
shows a non-zero exit code.

## Running it by hand

Task Scheduler → Task Scheduler Library → right-click the task → **Run**. Or:

```powershell
Start-ScheduledTask -TaskName "Beer Deals - weekly import of the three blocked chains"
```

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
