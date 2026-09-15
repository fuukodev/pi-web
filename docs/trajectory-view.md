# Trajectory View Specification

## Objective

Add an in-app execution trajectory view for saved Pi Web sessions. The view is a
read-only projection of the active session branch that makes turns, assistant
steps, tool calls/results, compaction, and live execution state easier to scan
than the chat transcript. Chat remains the primary editing surface and Full
History remains the complete archive/export surface.

## v1 scope

- Toggle between Chat and Trajectory without unmounting the session input or
  creating a second SSE connection.
- Project only the active branch into Turn/Record data.
- Page by logical turns so an assistant tool call and its result cannot be split
  across pages.
- Render a compact ledger, a sequential overview, and an on-demand inspector.
- Show running assistant/tool state from `useAgentSession` as a transient live
  overlay; refresh persisted trajectory after a run settles.
- Support desktop inspector side panes and mobile inspector drawers.
- Add English, Simplified Chinese, and Traditional Chinese UI messages.

Out of scope for v1: precise TTFT/provider request telemetry, duration-mode
zooming and range selection, full branch-tree duplication, new dependencies,
and a second event stream.

## API contract

`GET /api/sessions/:id/trajectory?leafId=&cursor=&limit=` returns the active
branch's newest page of complete turns, ordered oldest-to-newest within the
page. `limit` defaults to 20 and is capped at 50. `cursor` is the stable
`startEntryId` of the oldest previously returned turn. The response includes
`leafId`, `turns`, `nextCursor`, `hasEarlier`, and active-branch statistics.

`GET /api/sessions/:id/trajectory/records/:entryId?leafId=&toolCallId=` returns
bounded detail for one projected record. It must verify branch membership and
must not accept client-provided filesystem paths. Large thinking/tool output is
truncated or loaded through existing bounded media/detail endpoints.

Invalid session ids return 404; invalid pagination parameters return 400;
unexpected server failures return a generic 500 error without filesystem
paths or raw provider diagnostics.

## Data model

The projection uses stable entry ids and tool call ids rather than array
indexes. A record contains `id`, `kind`, `turnId`, source ids, status, summary,
optional preview, timestamp, duration and duration source, and usage. Historical
duration is explicitly `estimated` or `unknown`; live duration is `live`.

A user message starts a turn. Assistant content blocks become assistant and
child tool records. Tool results pair by `toolCallId`; orphaned results remain
visible as error/unknown records. Bash execution, compaction, branch summary,
model changes, and thinking-level changes are retained as metadata records.
Only the active branch returned by `sliceActiveBranch` is projected.

## UI and accessibility

The trajectory button is part of the existing chat toolbar and mobile More
menu. Saved sessions enable it; unsaved composers keep the button disabled.
The pane has named regions for overview and ledger. The inspector is closed by
default and is rendered only for persisted user, assistant, or tool records;
clicking the selected record again closes it. Bash, compaction, metadata, and
live overlay records remain navigable without opening a detail pane.

Overview Turn and Live controls navigate the ledger without selecting a record
or opening the inspector. Live navigation targets the transient `turn:live`
ledger block; the v1 live overlay does not fabricate a persisted user entry.
Every record is keyboard focusable/selectable, all icon-only controls have
translated labels, and loading, error, empty, and no-details states are
explicit. Role colors use separate theme tokens for user, assistant, tool,
bash, and metadata records; status text/markers remain independent so color
is never the only semantic signal. Layout is verified at 320, 768, 1024, and
1440px.

## Project structure

- `lib/trajectory/`: pure projection, types, bounded query helpers, and unit
  tests.
- `app/api/sessions/[id]/trajectory/`: list and record detail routes/tests.
- `hooks/`: trajectory server-state and live-overlay hooks.
- `components/trajectory/`: presentation-only pane, overview, ledger, and
  inspector components.
- `docs/adr/0005-trajectory-view.md`: architectural rationale.

## Verification commands

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
npm run dev
```

Do not run `next build` during development. The existing uncommitted
`package-lock.json` change is unrelated and must not be staged by this feature.

## Boundaries

- Always: validate route inputs, use stable ids, cap response/detail sizes,
  reuse the existing active-branch reader, and test each behavior before
  expanding the slice.
- Ask first: adding dependencies, changing persisted session format, adding
  telemetry, or changing the Full History export contract.
- Never: create a second SSE connection, expose arbitrary file paths, render
  unsanitized HTML, leak raw credentials/provider diagnostics, or include the
  pre-existing `package-lock.json` change in feature commits.

## Success criteria

1. Projector tests cover multiple tools, pairing, orphan/error results,
   compaction, branch exclusion, missing timestamps, and long linear sessions.
2. API tests prove logical-turn pagination, active-branch isolation, input
   bounds, bounded detail, and safe error responses.
3. Chat/Trajectory switching preserves the composer, running state, and chat
   scroll position without a second SSE.
4. The UI has complete loading/error/empty states, keyboard access, mobile
   inspector behavior, and translations in all built-in locales.
5. Tests, typecheck, and lint pass without modifying unrelated working-tree
   files.
