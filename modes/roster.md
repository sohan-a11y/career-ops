# Mode: roster — Excel Company Roster → Full Auto-Pipeline

Takes a spreadsheet of companies (name + career page URL, one row per company — however many the user has collected) and runs the whole chain end to end: resolve each company to a scannable ATS board, scan for matching postings, then evaluate + tailor + track every posting that lands in the inbox. This is the bulk front door: `scan` handles portals.yml's existing tracked companies one at a time; `roster` is for "I found N companies somewhere else (a spreadsheet, a list a friend sent, a market map) and want them all folded in and processed."

## What's mechanical vs. AI-driven (read this before executing)

- **Ingestion + discovery + scan are mechanical** — `roster.mjs` (Excel parsing, ATS resolution via `discover-ats.mjs`, portals.yml write, scoped scan) does this with zero LLM tokens, the same way `scan.mjs`/`discover-ats.mjs` already work standalone.
- **Evaluation + tailoring + tracking are AI-driven** — once new postings land in `data/pipeline.md`, this mode hands off to **`modes/pipeline.md`'s existing workflow verbatim** (liveness sweep → pre-screen gate → full A–F evaluation → report → PDF → tracker, parallelized via the Agent tool for 3+ URLs). Do not reimplement that logic here — read and follow `modes/pipeline.md` for that half of the run.

## Recommended Execution

Same as `scan`/`pipeline`: for a large roster, prefer a background subagent so the run doesn't block the interactive session, but the discovery half is fast/cheap enough that running it inline first (to show the user what's about to be written) is usually the better UX — see Step 2.

## Workflow

### Step 1 — Locate the file

If the user hasn't given a path, ask for one. Accept `.xlsx`, `.xlsm`, or `.csv` (legacy binary `.xls` is not supported — ask the user to re-save it as `.xlsx` if that's what they have). There is no fixed required location; a natural default to suggest is `data/company-roster.xlsx`, but any path works.

Expected shape: one row per company, any column order. Header names are matched case-insensitively (a "company"/"name"/"employer" column, a "career page"/"careers url"/"url"/"link" column). A sheet with no recognizable header falls back to the first two columns positionally.

### Step 2 — Preview (always run this first, unread-only)

```bash
node roster.mjs <file>
```

This is preview-only by design — it resolves every company (direct ATS-URL detection + `discover-ats.mjs` probing for branded career pages) and prints what it *would* write, but touches nothing. Show the user:
- How many companies resolved vs. need manual follow-up (unresolved companies are usually JS-rendered career pages or non-standard ATS setups — flag them, don't silently drop them)
- How many are already tracked (duplicates) vs. genuinely new
- Any row warnings (bad URLs, missing names, duplicate rows in the sheet itself)

### Step 3 — Confirm before writing (persistent configuration — ask)

`portals.yml` is user-layer persistent configuration. Before adding new companies to it, confirm with the user: *"Add {N} new companies to portals.yml and scan them for matching roles?"* If they've already said "run everything" for this session/request, treat that as the confirmation and proceed without asking again per company — the gate is about the roster run as a whole, not per row.

### Step 4 — Write + scoped scan

```bash
node roster.mjs <file> --write --scan
```

This appends the resolved companies to `portals.yml` (`tracked_companies`, deduped against what's already there) and runs a scan scoped to just the newly-added companies — not a full re-scan of everyone already tracked. Matching postings land in `data/pipeline.md` the same way a normal `/career-ops scan` run would.

Live progress is written to `data/roster-telemetry.json` throughout Steps 2–4 (ingest → discover → scan → done). If the user has a second terminal open, `npm run roster:watch` tails it live; otherwise this doesn't matter — report progress in chat as usual.

### Step 5 — Hand off to the full pipeline

Once Step 4 finishes, read and execute **`modes/pipeline.md`** in full — liveness sweep, pre-screen gate, per-URL evaluation, report, PDF, tracker row, parallel Agent fan-out for 3+ URLs. This is not a separate reimplementation; it is the existing pipeline mode processing whatever now sits in `data/pipeline.md`'s "Pending" section, exactly as if the user had pasted those URLs in by hand.

### Step 6 — Summary

At the end, show one combined table spanning both halves of the run:

```
| Company | ATS | Jobs Found | Evaluated | Best Score | Report |
```

Plus counts: companies resolved / unresolved, postings found / evaluated / skipped (pre-screen or liveness) / tracked.

## What this mode never does

Same ethical-use rules as everywhere else in career-ops (see `AGENTS.md` → "Ethical Use"): this mode evaluates, tailors, and tracks in bulk, but it **never submits an application**. A roster run can walk away with dozens of tracked, scored, PDF'd offers — the user still reviews and clicks each one themselves via `/career-ops apply`.

## Errors and partial failures

- A company that fails ATS resolution is reported as unresolved, not silently dropped — it stays out of `portals.yml` until the user gives it a manual `careers_url`/`workday` hint (same as `discover-ats.mjs` used standalone).
- A scoped scan failure for one company does not abort the run for the others — `roster.mjs` continues through the remaining companies and reports the failure in its summary and in `data/roster-telemetry.json` (`status: "error"`).
- If `data/pipeline.md` ends up empty after Step 4 (nothing new matched the user's `title_filter`/`location_filter`), say so plainly and stop — there is nothing for Step 5 to do.
