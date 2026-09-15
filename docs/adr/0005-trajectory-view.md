# 0005: In-app active-branch trajectory view

Date: 2026-09

## Status

Accepted

## Context

Pi Web currently offers the live chat transcript and a separate Full History
export. The transcript is optimized for conversation and composer interaction;
the export is optimized for complete archival browsing. Neither gives users a
compact execution ledger that groups turns, assistant steps, tool calls/results,
compaction, and currently running work.

The session log is an append-only tree. Chat already has a safe active-branch
reader and a reconnecting SSE lifecycle. Rebuilding a second history fold or a
second live stream would create inconsistent behavior, especially during
compaction, reconnect, and branch navigation.

## Decision

1. Add an in-app Trajectory view as a derived, read-only projection of the
   active branch. It is not a second persisted session format.
2. Keep projection logic in pure `lib/trajectory` functions. The projection
   uses stable entry ids and tool call ids and pairs tool results without
   relying on array positions.
3. Expose trajectory data through a dedicated, paged endpoint. Pages are made
   of complete logical Turns, not raw entries, so an assistant tool call and
   its result stay together.
4. Reuse `sliceActiveBranch` and existing session path/security resolution.
   The trajectory endpoint is not added to the general session-detail payload.
5. Fetch historical trajectory lazily, and use `useAgentSession`'s existing
   stream/reconciliation state for transient assistant/tool overlays. Do not
   create another SSE connection.
6. Mark historical time as `estimated` or `unknown` unless the session file
   contains enough timestamps to calculate it. Mark browser-observed running
   time as `live`; do not imply provider-level TTFT or request timing.
7. Keep the first UI intentionally small: sequential overview, compact ledger,
   inspector, and responsive mobile drawer. Defer timeline zoom/range selection
   and virtualization until measurements justify them.
8. Keep Full History as the canonical raw archive. Inspector links may deep-link
   to it, but Trajectory does not duplicate its branch tree or export behavior.
9. Keep the Inspector closed by default. Only persisted user, assistant, and
   tool records can open it; repeated selection toggles it closed. Overview
   Turn and Live controls only navigate the ledger, with Live targeting the
   transient `turn:live` block rather than fabricating a persisted user entry.
   Role-specific theme tokens are independent from status indicators so color
   does not carry meaning alone.
10. Project assistant thinking blocks as their own `thinking` records and show
    a bounded `name(key=value, …)` call signature for tool records. Tool result
    text moves to `resultPreview`/the inspector instead of replacing the call
    preview, so the ledger describes what was requested rather than what came
    back.
11. Search the active branch through a dedicated bounded endpoint instead of
    filtering only loaded pages. Query length, result count, scanned matches,
    and wall-clock time are capped; search matches message text, thinking, and
    tool call names/arguments, while closing the search clears its state.
12. Reuse the chat search-target pipeline for jumps. A jump switches back to
    chat, loads bounded older pages, scrolls to the entry (or exact tool call
    block), highlights it, and shows a dismissible notice when the position is
    beyond the loaded bound. Inspector jumps use the same path rather than
    opening Full History.

## Alternatives considered

### Reuse the Full History exporter in the app

Rejected. The exporter loads a complete tree and runs independently in a new
window, which is unsuitable for incremental loading, live state, and the
existing composer/SSE lifecycle.

### Split assistant thinking into its own record kind

Accepted. Thinking is assistant content, but readers scan reasoning and answers
differently, and the search filter needs to address them separately. The extra
kind is mechanical: label keys, a role color token, inspectability, and a
`recordId` detail parameter keep one assistant entry's rows distinct.

### Search only the loaded ledger window client-side

Rejected. The pane loads bounded turn pages, so client-only filtering would
silently miss older matches. The server scans the active branch under explicit
caps and reports `truncated`; anchoring a page on a hit then needs one request
instead of replaying every page in between.

### Add a second SSE connection for Trajectory

Rejected. It duplicates reconnect/reconciliation logic and can show a different
streaming state from Chat. The existing `useAgentSession` state is the source
of truth for live overlays.

### Page raw session entries

Rejected. A page boundary can separate an assistant tool call from its tool
result, making the primary ledger misleading. Trajectory pages are grouped by
logical Turn instead.

### Add a virtualization dependency immediately

Deferred. The first version uses bounded Turn pages and a simple ledger. Long
session behavior will be measured before adding a dependency or more complex
row model.

## Consequences

- The feature has a small, testable seam between session entries and UI DTOs.
- Historical duration is honest but approximate until Pi persists richer
  telemetry.
- The API and UI need separate loading/error handling from Chat context pages.
- Active-branch projection must be retested whenever session-tree semantics
  change.
- Search adds one bounded scan route and one extra page-fetch mode (`anchor`);
  jumping to an anchored page replaces the loaded window, so the pane must
  expose `hasLater` and a way back to the tail.
- Chat jumps reuse `searchTarget`, so improvements to that pipeline (deeper page
  loading, tool-call anchors, failure notice) also benefit session search.
- Users get an actionable execution view without changing existing session
  files or the Full History contract.
