# Pipeline notes for TutorLink

Read by the orchestrator before running the planner/coder pipeline in this repo.

## Project board sync

Every issue and pull request belongs on the GitHub Project **TutorLink** (`Neves-Labs-Inc`, project number **4**), in the iteration that covers today, with a Status that follows the pipeline. The `Project sync` workflow (`.github/workflows/project-sync.yml`) does the add, iteration and PR status automatically on GitHub events; these steps cover what it can't see (a coder starting work) and runs where the workflow isn't available.

| Pipeline event | Item | Status |
|---|---|---|
| Issue or PR created | that issue/PR | add to project, Iteration = current, Status = Backlog (issue) / In review (PR) |
| Coder dispatched on a ticket tied to an issue | the issue | In progress |
| PR opened for the work | the issue and the PR | In review |
| PR merged / issue closed | both | Done (the project's built-in workflows also do this) |

Commands (needs `gh` with the `project` scope: `gh auth refresh -h github.com -s project`):

```bash
P=4; O=Neves-Labs-Inc
PID=$(gh project view $P --owner $O --format json --jq .id)
# add an issue or PR; prints the item id
ITEM=$(gh project item-add $P --owner $O --url <issue-or-pr-url> --format json --jq .id)
# current iteration id (the one whose window covers today)
read FID_ITER ITER <<<"$(gh api graphql -f query='query{organization(login:"Neves-Labs-Inc"){projectV2(number:4){field(name:"Iteration"){... on ProjectV2IterationField{id configuration{iterations{id startDate duration}}}}}}}' \
  --jq '.data.organization.projectV2.field as $f | ($f.configuration.iterations[] | select((.startDate|strptime("%Y-%m-%d")|mktime) <= now and now < ((.startDate|strptime("%Y-%m-%d")|mktime) + .duration*86400)) | "\($f.id) \(.id)")')"
gh project item-edit --id "$ITEM" --project-id "$PID" --field-id "$FID_ITER" --iteration-id "$ITER"
# status: Backlog | New | In progress | In review | Done
FID_STATUS=$(gh project field-list $P --owner $O --format json --jq '.fields[]|select(.name=="Status")|.id')
OPT=$(gh project field-list $P --owner $O --format json --jq '.fields[]|select(.name=="Status")|.options[]|select(.name=="In progress")|.id')
gh project item-edit --id "$ITEM" --project-id "$PID" --field-id "$FID_STATUS" --single-select-option-id "$OPT"
```

To find the item id of something already on the board: `gh project item-list 4 --owner Neves-Labs-Inc --limit 300 --format json --jq '.items[]|select(.content.number==<n>)|.id'`.

## Commands

- API (from `api/`): `UV_SYSTEM_CERTS=1`; tests need a fresh DB: `docker exec tutorlink-test-pg psql -U test -d postgres -c "CREATE DATABASE <name>;"`, then `DATABASE_URL=postgresql+psycopg://test:test@localhost:5432/<name> uv run pytest`, drop `<name>` and `<name>_test` afterwards. For a faster run, opt in to 4 parallel workers with `uv run pytest -n 4` (CI runs `-n auto`); each worker uses its own `<name>_test_gw0`..`gw3`, so also drop every `<name>_test_gw*` afterwards. Lint: `uv run ruff check` and `uv run ruff format --check app tests scripts` (never format `alembic/`).
- Dashboard (from `dashboard/`): `npm run test`, `npx tsc -b`, `npm run lint`, `npm run build`.
- PRs target `develop`; `main` is deployed by the Deploy workflow.

## Gotchas

Collected from agent `env:` lines during API gaps round 2 (2026-10-16).

- **Agent-tool worktrees branch from a stale base.** `isolation: "worktree"` created worktrees under `~/Documents/freelance/TutorLink/.claude/worktrees/` on old `main`, not the current branch. Coders had to `git reset --hard <branch tip>` first. Prefer `git worktree add ../<repo>-wt-<NN> HEAD`.
- **Worktree sandbox blocks writes outside the worktree.** Coders can't write notes into the main tree's `.scratch/`; they leave them in the scratchpad or the worktree and the orchestrator copies them over. It also refuses long compound Bash commands; split them.
- **Shared test Postgres under parallel load.** With ~10 suites at once the full suite takes ~12 min, and `test_auth_rate_limit.py` (concurrency/barrier tests) and `test_broadcast_service.py` (quiet listener) flake. Rerun them alone before calling a failure real. Use a unique DB name per agent. Run the suite in the background redirected to a file; a `tail`-piped run looks hung.
- **Applying worktree patches over uncommitted work.** `git apply --3way` refuses files whose working copy differs from the index. Try plain `git apply --check` first (patches made on the same base apply cleanly); otherwise stage, `--3way`, then unstage.
- **New routes need a `test_route_matrix.py` entry.** Every coder that added a route hit 2 failures there first.
- **Schema validation errors are 400, not 422.** `app/main.py` maps every `RequestValidationError` to 400 `{"detail": "field: ..."}`.
- **`security-review` skill reads the main checkout's branch diff**, not a worktree; security reviewers review the scoped worktree diff by hand.

Collected during the WhatsApp bot agent wave 1 (2026-10-19).

- **Never kill test runs by pattern.** A coder's `pkill -f "pytest -q -p no:cacheprovider"` killed every parallel coder's suite. Kill your own run by PID only.
- **`run_in_background` suite runs can die with exit 144** at ~15–37% under parallel load. Start the full suite with `nohup ... > /tmp/<name>.log 2>&1; echo "EXIT $?" >> /tmp/<name>.log &` and read the log's tail.
- **Load flake:** `test_conversation_routes.py::test_total_counts_the_filtered_query_before_paging` can fail under parallel load; rerun the module alone.
- **`git worktree remove` must run from inside the repo**, not the parent folder.
- **Aborted test runs leave committed rows** in `<db>_test` that break later row-counting suites (`test_cli_seed`). Drop `<db>_test` after any killed run.
- **`test_bot_worker.py` lock count is cluster-wide** (`pg_locks` with no database filter); it can flake if another agent runs it at the same time. Rerun alone.
- **conftest imports run before the test env is set.** A fixture module that imports `app.db` at top level breaks test collection; import it lazily inside the fixture.
- **`bot_worker.hold_turns` inside a bot turn waits forever** on that turn's own chat lock. Never call it from agent-tool code paths; pytest runs that hit it hang (kill by PID, drop the `_test` DB with FORCE).
- **Design reviewers share one Playwright browser.** Parallel reviewers can land on each other's pages. Open a fresh page with `page.context().newPage()` and re-register `page.route` stubs in every `browser_run_code` call (globalThis doesn't persist). Kill the Vite child process when done.
- **Never kill a dev server by port.** `lsof -ti:<port> | xargs kill` once hit Docker Desktop (it publishes 5433) and took down the shared test Postgres mid-suite. Kill by PID or exact command line only.
- **Landing parallel dashboard tickets can break each other's test fixtures** (a new required wire field, e.g. `CountsRead.children_needing_tutor`). Run tsc + tests on the combined tree before committing.
- Design reviewers in parallel: port 5791 is often taken by another reviewer's Vite. Each reviewer runs Vite with `--strictPort` on its own port (6000-6999).
- Playwright `page.route` with a regex on `/api/` or a glob like `**/auth/**` also catches Vite source modules (`src/lib/api.ts`, `src/lib/auth/auth.ts`) and breaks the app with a MIME error. Match on `url.pathname.startsWith("/api/")` instead.
- macOS has no `timeout` command; run a single test file with `npx vitest run <file>`.
- Browser-test API mocks that answer unknown URLs with a catch-all object (e.g. COUNTS) break when another ticket's real screen mounts on a route the test navigates to. Stub each call the screen makes (empty pages, `post` included); run the full suite on the combined tree after landing several tickets.
- When two tickets add the same query factory (e.g. `staffQueries.active()`), check the data shapes match before landing: same queryKey with different shapes corrupts the cache.
- Landing a worktree that deletes or adds binary files (images): build the patch with `git diff --binary`, or `git apply` fails the whole patch and applies nothing.
- **Deleting test files can drop global types.** A browser test may carry `/// <reference types="@vitest/browser-playwright" />` that other tests rely on (CDPSession.send, node types). After deleting tests, run `npx tsc -b`; the reference now lives in `dashboard/src/test/browser-setup.ts`.
- Kit `Button` with `isLoading` uses `aria-disabled`, not native `disabled` (it keeps focus). Playwright treats aria-disabled as non-actionable, so tests that click a loading Button need `{ force: true }`; `toBeDisabled()` also accepts aria-disabled, so assert `toHaveAttribute("disabled")` for a native disable.
- **A failing `expect.element` takes 15 s, not 3 s.** In Vitest 4.1.11, `expect.element` ignores `expect.poll.timeout` from `dashboard/vite.config.ts` and waits out the 15 s test timeout. A browser test stuck near 15 s is a failing or barely-passing assertion; look for a toast covering the target, a substring `getByText` also matching a toast, or a click during an overlay's enter animation (wait for `toBeInViewport({ ratio: 1 })`).
