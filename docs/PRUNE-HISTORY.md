# Pruning the price history (0.38.1, migration 0052) — production steps for Yoni

Production's database is over the free plan's 0.5 GB (548 MB on 2026-10-12). Two causes, both fixed by 0052:

1. Every daily import re-recorded every price and promotion, changed or not (~60,000 rows, ~37 MB a day).
   Now an unchanged price is only marked as seen again; one row a week is still written, for the Deal Score's
   history.
2. History nothing reads was kept forever. `prune_history` deletes it, in batches, after every import:
   - rejected price rows (rolled-back runs and resets);
   - "where is this promotion" rows from files that are no longer current;
   - branch scans older than a week (the latest scan of every chain is always kept);
   - mix-and-match promotions that were replaced or rejected.

   It never touches live, held or superseded prices (the Deal Score reads 180 days of them) or notification
   events (they are what stops a deal being announced twice).

**On staging (2026-10-14):** 845 MB → **474 MB**. The app's numbers did not change: 524 offers, 1,028
promotions, 70,430 live prices, 366 deal scores.

## Steps (about 15 minutes; do them outside 05:00–06:00 UTC, when the daily import runs)

In the repository folder, in Git Bash, with the production ref in `$PROD_REF` and the CLI linked to it
(`docs/PRODUCTION-HANDOFF-YONI.md` §B):

1. **Prove the target:**

   ```bash
   bash scripts/production/assert-production.sh "$PROD_REF"
   ```

2. **Backup.** Supabase → Database → Backups: the newest daily backup is completed and under 24 hours old.
   Pruning deletes rows; the backup is the only way back.

3. **Migration.** The dry run must list only `0052_prune_history.sql`:

   ```bash
   bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase db push --dry-run
   ```

   ```bash
   bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase db push
   ```

4. **Count, then prune.** `.env.production.local` as in the handoff §J route 2. Write down the counts.
   The second command deletes in batches (staging took 77 seconds):

   ```bash
   node scripts/ingest/prune-history.mjs --target production --confirm-ref "$PROD_REF"
   ```

   ```bash
   node scripts/ingest/prune-history.mjs --target production --confirm-ref "$PROD_REF" --apply
   ```

5. **Give the space back.** Deleting frees space inside the database. The size Supabase counts drops only after
   `vacuum full`, which rewrites each table and **locks it while it runs** (44 seconds for the price table on
   staging: pages wait, nothing is lost). Supabase → SQL Editor, one line at a time:

   ```sql
   vacuum (full, analyze) public.price_observations;
   vacuum (full, analyze) public.promotion_occurrences;
   vacuum (full, analyze) public.promotion_groups;
   vacuum (full, analyze) public.promotion_group_items;
   vacuum (full, analyze) public.branch_scans;
   select pg_size_pretty(pg_database_size(current_database()));
   ```

6. **Check the site:**

   ```bash
   node scripts/smoke-production.mjs --supabase-ref "$PROD_REF" --expect-data
   ```

From then on the production workflow prunes after every import by itself, and Postgres reuses the freed space
without another `vacuum full`.

**Rollback** (only with Ori): `supabase/rollback/0052_prune_history.down.sql` puts back a new row per file. It does
not bring pruned rows back; the backup does.

**Stage 2 (not in this release):** the superseded prices that only repeat the same price (97% of them on staging)
can be thinned too. That needs the Deal Score's history to be measured by time instead of by number of rows.
