# Tender intake MVP

The public-tender radar is scheduled in the Codex Anix task. It searches publicly visible B2B-Center, Roseltorg, Kontur.Zakupki, and EIS cards once daily. Verified candidates are scored with the local Anix financial rules and inserted into `public.tender_inbox` through the connected Supabase tool. It does not use a paid tender API.

The existing `amocrm-sync` function runs every 30 minutes. It processes up to 20 queued candidates per run with the server-side amoCRM OAuth connection and creates or updates leads in pipeline `11380854`, status `89173342`. Unknown financial and legal terms remain empty; the `missing` field lists them. A processed source key is never reinserted, so a lead deleted during human review is not automatically recreated.

The table has RLS and no anonymous or authenticated policies. Only the server-side role and authorized project operators can enqueue candidates. The sync creates the tender custom fields on first use. Rows with expired deadlines are marked `expired`; failed rows are retried at most three times. Review `last_error` for failures.

The source-of-truth query map and daily operator procedure live in the Anix business-model project under `anix_tenders/Daily_Radar_Runbook.md`. No subscription or platform login is needed for discovery, but participation in a specific procurement can have separate fees.
