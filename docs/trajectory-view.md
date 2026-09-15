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
- Search the active branch from the same pane, filter by record type (including
  thinking), and jump to a hit even when its turn is outside the loaded window.
- Jump from a record back to its chat position, including the exact tool call
  block, with a notice when deep history cannot be located.
- Add English, Simplified Chinese, and Traditional Chinese UI messages.

Out of scope for v1: precise TTFT/provider request telemetry, duration-mode
zooming and range selection, full branch-tree duplication, new dependencies,
and a second event stream.

## API contract

`GET /api/sessions/:id/trajectory?leafId=&cursor=&anchor=&limit=` returns the
active branch's newest page of complete turns, ordered oldest-to-newest within
the page. `limit` defaults to 20 and is capped at 50. `cursor` is the stable
`startEntryId` of the oldest previously returned turn. `anchor` is the stable
`startEntryId` of a turn that must be the newest turn of the page and cannot be
combined with `cursor`; search jumps use it to replace the window with one
anchored request. The response includes `leafId`, `turns`, `nextCursor`,
`hasEarlier`, `hasLater` (turns newer than the page exist), and active-branch
statistics.

`GET /api/sessions/:id/trajectory/search?q=&types=&leafId=&limit=` scans the
active branch for literal case-insensitive text in user messages, assistant
messages, thinking blocks, and tool call names/arguments. `q` is required and
capped at 200 characters; `types` accepts `user,assistant,thinking,tool`;
matches are newest-first and bounded to 50 by default, with a hard 1000-match
cap and a 3-second budget that set `truncated` instead of blocking the route.
Each match carries the full projected record, its 1-based `turnOrdinal`, a
windowed `snippet`, and the matched `field`.

`GET /api/sessions/:id/trajectory/records/:entryId?leafId=&toolCallId=&recordId=`
returns bounded detail for one projected record. `recordId` disambiguates
records that share an entry (for example a thinking row and its assistant row).
It must verify branch membership and must not accept client-provided filesystem
paths. Large thinking/tool output is truncated or loaded through existing
bounded media/detail endpoints.

Invalid session ids return 404; invalid pagination, anchor, search, or detail
parameters return 400; unexpected server failures return a generic 500 error
without filesystem paths or raw provider diagnostics.

## Data model

The projection uses stable entry ids and tool call ids rather than array
indexes. A record contains `id`, `kind`, `turnId`, source ids, status, summary,
optional preview, optional tool `resultPreview`, timestamp, duration and
duration source, and usage. Historical duration is explicitly `estimated` or
`unknown`; live duration is `live`.

A user message starts a turn. Assistant content blocks become assistant and
child tool records, and thinking blocks become a separate `thinking` record so
reasoning and answer text can be scanned (and searched) independently. Tool
records show a bounded `name(key=value, …)` call signature in `preview`; the
result text lives in `resultPreview` and the inspector rather than replacing
the call preview. Tool results pair by `toolCallId`; orphaned results remain
visible as error/unknown records. Bash execution, compaction, branch summary,
model changes, and thinking-level changes are retained as metadata records.
Only the active branch returned by `sliceActiveBranch` is projected.

## UI and accessibility

The trajectory button is part of the existing chat toolbar and mobile More
menu. Saved sessions enable it; unsaved composers keep the button disabled.
The pane has named regions for overview and ledger. The inspector is closed by
default and is rendered only for persisted user, assistant, thinking, or tool
records; clicking the selected record again closes it. Bash, compaction,
metadata, and live overlay records remain navigable without opening a detail
pane.

Overview Turn and Live controls navigate the ledger without selecting a record
or opening the inspector. Live navigation targets the transient `turn:live`
ledger block; the v1 live overlay does not fabricate a persisted user entry.
The header offers a search button immediately before retry. Expanding it shows
a type selector (All/User/Assistant/Thinking/Tool), a combobox input with
arrow-key result navigation, and a results list; typing `user:`, `a:`, `th:`,
`tool:` and similar prefixes switches the type filter (the prefix list lives in
the type selector's tooltip rather than the header). Closing the search clears
text and results. Selecting a result selects the record and scrolls the
ledger, fetching an anchored page when the turn is not loaded; a `Jump to
latest` control restores the tail window in that case.

Every record is keyboard focusable/selectable. Enter on an already-selected
record jumps to its chat position, as does the inspector's icon button to the
left of close; the jump switches back to chat, loads bounded older pages until
the entry is present (up to 10 pages of 200 entries), scrolls instantly to the
exact tool call block when one is known, and shows a dismissible notice when
the position cannot be located. While those pages load the transcript stays
hidden behind a locating status, so the final position appears directly
instead of replaying intermediate scroll adjustments. Space keeps its select/deselect behavior. All icon-only
controls have translated labels, and loading, error, empty, and no-details
states are explicit. Role colors use separate theme tokens for user, assistant,
thinking, tool, bash, and metadata records; status text/markers remain
independent so color is never the only semantic signal. Failed records (tool
errors, provider errors, non-zero exits) override the role color with the error
token, tint the row, repeat the error text, and mark the owning turn in the
overview. Layout is verified at
320, 768, 1024, and 1440px.

## Project structure

- `lib/trajectory/`: pure projection, search, tool-preview, types, bounded
  query helpers, and unit tests.
- `app/api/sessions/[id]/trajectory/`: list, search, and record detail
  routes/tests.
- `hooks/`: trajectory server-state, search, and live-overlay hooks.
- `components/trajectory/`: presentation-only pane, search, overview, ledger,
  and inspector components.
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
   compaction, branch exclusion, missing timestamps, thinking separation, tool
   call signatures, and long linear sessions.
2. API tests prove logical-turn pagination, anchored pages, active-branch
   isolation, input bounds, bounded details, bounded search, and safe error
   responses.
3. Chat/Trajectory switching preserves the composer, running state, and chat
   scroll position without a second SSE.
4. Search results, anchored jumps, and chat jumps are keyboard-operable with
   translated labels, remain bounded server-side, and degrade to an explicit
   notice instead of a silent failure.
5. The UI has complete loading/error/empty states, keyboard access, mobile
   inspector behavior, and translations in all built-in locales.
6. Tests, typecheck, and lint pass without modifying unrelated working-tree
   files.
