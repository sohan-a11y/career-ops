/**
 * gemini-spark-dispatch.gs — the missing link between the Gemini Spark job-
 * discovery prompt and career-ops's GitHub Actions cloud pipeline.
 *
 * WHY THIS EXISTS (read this before wiring anything):
 * Gemini Spark's native actions cannot POST to an arbitrary third-party REST
 * API like GitHub's — its built-in HTTP layer only supports GET-style reads,
 * and the one documented workaround (connecting Spark to a custom MCP server)
 * is presently unstable / breaking in the field. So Spark cannot reliably
 * call GitHub's `repository_dispatch` endpoint directly, today.
 *
 * What Spark CAN reliably do — this is unchanged from before — is read
 * public JSON job-board APIs (a GET request) and write rows into a Google
 * Sheet (its native, fully-supported Sheets connector). This script picks up
 * exactly where Spark's reliable native abilities end: it is a normal Apps
 * Script bound to the SAME Sheet Spark writes into, running on Apps Script's
 * own time-driven trigger (a long-standing, non-beta feature — not a Spark
 * Schedule, not a Spark Task), and it does the one thing Spark can't do
 * itself: POST to GitHub's REST API to kick off career-ops's cloud pipeline.
 *
 * Spark never needs GitHub credentials and never makes the POST — this
 * script does, server-side, using a token stored in Apps Script's own
 * Script Properties (never pasted into a cell, never visible to Spark or
 * the sheet's other viewers).
 *
 * ── ONE-TIME SETUP ──────────────────────────────────────────────────────
 * 1. Open the Google Sheet your Spark prompt writes to (the
 *    Job_Application_Tracker). Extensions -> Apps Script.
 * 2. Paste this whole file in as a new script file.
 * 3. Project Settings (gear icon) -> Script Properties -> add:
 *      GITHUB_PAT        a fine-grained PAT, scoped to ONLY your private
 *                        career-ops fork, with "Contents: Read and write"
 *                        permission (that's the permission repository_dispatch
 *                        actually checks — not "Actions", despite the name).
 *                        Create one at github.com/settings/personal-access-tokens
 *      GITHUB_OWNER      your GitHub username (the fork's owner)
 *      GITHUB_REPO       your fork's repo name, e.g. career-ops
 * 4. Run `setupTrigger` once from the Apps Script editor (Run button, pick
 *    that function) and approve the permissions prompt. This installs a
 *    15-minute time-driven trigger — adjust the interval in setupTrigger.
 * 5. Test it immediately without waiting 15 minutes: run `dispatchPendingRows`
 *    directly from the editor. Check the Apps Script execution log, then
 *    check your fork's Actions tab for a new "career-ops cloud pipeline" run.
 *
 * ── WHAT IT DOES EVERY RUN ────────────────────────────────────────────────
 * 1. Reads the tracker Sheet, finds rows where Status == "Pending" that
 *    haven't been dispatched yet (no value in the Dispatched column).
 * 2. Batches them (GitHub caps client_payload at 10 top-level properties /
 *    64KB total — comfortably enough URLs per call; this script also caps
 *    at MAX_URLS_PER_DISPATCH as a courtesy against GitHub's abuse-rate limit
 *    on rapid repeated POSTs).
 * 3. POSTs one repository_dispatch call per batch to your fork, event_type
 *    "career-ops-run", client_payload { mode: "pipeline", job_urls: [...] }
 *    — matching .github/workflows/cloud-pipeline.yml's expected shape.
 * 4. Marks each dispatched row's Dispatched column with a timestamp, so a
 *    re-run of this function never double-dispatches the same row.
 *
 * The GitHub Actions run itself then does the real work: evaluates each URL
 * through career-ops's actual scoring pipeline, computes the deterministic
 * ATS keyword-match score (ats-match-score.mjs), writes reports/PDFs, and
 * commits everything back to your fork — see cloud-pipeline.yml for the
 * full chain. This script's only job is the one POST Spark can't make.
 */

const SHEET_NAME = 'Job_Application_Tracker'; // match your Spark prompt's tab name
const STATUS_COL_HEADER = 'Status';
const URL_COL_HEADER = 'URL';
const DISPATCHED_COL_HEADER = 'Dispatched'; // script adds this column if missing
const MAX_URLS_PER_DISPATCH = 15;
const EVENT_TYPE = 'career-ops-run';

function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'dispatchPendingRows')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dispatchPendingRows')
    .timeBased()
    .everyMinutes(15) // adjust: 15 is the minimum Apps Script allows for time-based triggers
    .create();
  Logger.log('Installed a 15-minute trigger for dispatchPendingRows.');
}

function dispatchPendingRows() {
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty('GITHUB_PAT');
  const owner = props.getProperty('GITHUB_OWNER');
  const repo = props.getProperty('GITHUB_REPO');
  if (!pat || !owner || !repo) {
    Logger.log('Missing Script Properties: GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO. See setup comment at top of file.');
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log(`Sheet tab "${SHEET_NAME}" not found.`);
    return;
  }

  const data = sheet.getDataRange().getValues();
  const header = data[0];
  let statusCol = header.indexOf(STATUS_COL_HEADER);
  let urlCol = header.indexOf(URL_COL_HEADER);
  let dispatchedCol = header.indexOf(DISPATCHED_COL_HEADER);

  if (statusCol === -1 || urlCol === -1) {
    Logger.log(`Sheet must have "${STATUS_COL_HEADER}" and "${URL_COL_HEADER}" columns.`);
    return;
  }
  if (dispatchedCol === -1) {
    dispatchedCol = header.length;
    sheet.getRange(1, dispatchedCol + 1).setValue(DISPATCHED_COL_HEADER);
  }

  const pending = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const status = String(row[statusCol] || '').trim().toLowerCase();
    const alreadyDispatched = dispatchedCol < row.length && row[dispatchedCol];
    if (status === 'pending' && !alreadyDispatched && row[urlCol]) {
      pending.push({ rowIndex: r + 1, url: String(row[urlCol]).trim() });
    }
  }

  if (pending.length === 0) {
    Logger.log('No new Pending rows to dispatch.');
    return;
  }

  for (let i = 0; i < pending.length; i += MAX_URLS_PER_DISPATCH) {
    const batch = pending.slice(i, i + MAX_URLS_PER_DISPATCH);
    const ok = sendDispatch(owner, repo, pat, batch.map((b) => b.url));
    if (ok) {
      const now = new Date().toISOString();
      batch.forEach((b) => sheet.getRange(b.rowIndex, dispatchedCol + 1).setValue(now));
      Logger.log(`Dispatched ${batch.length} URL(s), rows ${batch[0].rowIndex}-${batch[batch.length - 1].rowIndex}.`);
    } else {
      Logger.log(`Dispatch failed for rows starting at ${batch[0].rowIndex} — left un-marked, will retry next run.`);
    }
  }
}

function sendDispatch(owner, repo, pat, jobUrls) {
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const payload = {
    event_type: EVENT_TYPE,
    client_payload: { mode: 'pipeline', job_urls: jobUrls, requested_by: 'gemini-spark-dispatch.gs' },
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${pat}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 204) {
    // repository_dispatch returns 204 even for a typo'd event_type match failure
    // (no workflow listened) — a non-204 here is a real error (auth/repo/rate-limit).
    Logger.log(`GitHub dispatch returned ${code}: ${response.getContentText()}`);
    return false;
  }
  return true;
}
