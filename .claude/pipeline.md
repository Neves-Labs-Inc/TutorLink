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

- API (from `api/`): `UV_SYSTEM_CERTS=1`; tests need a fresh DB: `docker exec tutorlink-test-pg psql -U test -d postgres -c "CREATE DATABASE <name>;"`, then `DATABASE_URL=postgresql+psycopg://test:test@localhost:5432/<name> uv run pytest`, drop `<name>` and `<name>_test` afterwards. Lint: `uv run ruff check` and `uv run ruff format --check app tests scripts` (never format `alembic/`).
- Dashboard (from `dashboard/`): `npm run test`, `npx tsc -b`, `npm run lint`, `npm run build`.
- PRs target `develop`; `main` is deployed by the Deploy workflow.
