# ADR-0004: Persist selected-output consultation sessions as hidden child sessions

## Status

Accepted

## Context

Pi Web can quote selected assistant output and ask a question in a new chat. The
existing implementation creates a branch session, which copies conversation
history, appears as a top-level session, and moves the active workspace to that
session. That behavior does not represent a focused question about one output
fragment.

The feature needs to support:

- assistant text, thinking, tool-call input, and tool-result output as sources;
- selection-only and current-turn context modes;
- the exact effective model of the source session at creation time;
- an independent context that never appends messages to the source session;
- persistent child history that survives a page reload;
- a session hierarchy where the global session list shows only top-level sessions.

The existing in-session branch tree and persisted subagent sessions have
separate semantics and must not be conflated with this relationship.

## Decision

Create a new empty persisted `AgentSession` for each consultation. Set its
session header `parentSession` to the source session file, and write a
`pi-web:consultation` custom metadata entry before the first prompt. Do not use
`createBranchedSession`, because a consultation must not copy the source
conversation.

The child stores the prompt snapshot generated at creation time. Its model and
thinking level are inherited as a creation-time snapshot; later model changes
in the parent do not mutate an existing child. The child starts with no tools,
extensions, skills, prompt templates, or project context files. Its fixed system
prompt treats the copied source material as untrusted reference data and the
final question as the only task.

Consultation sessions are persisted like normal sessions but are classified as
nested children by a centralized session-hierarchy module. They are omitted
from the top-level sidebar and are listed through the parent session's child
navigator. Existing fork and subagent semantics remain unchanged.

## Prompt contract

The server builds the initial user prompt. In selection mode it contains only
one `<selected_output>` reference. In current-turn mode it serializes the
chronological current turn using typed sections for the user message,
assistant text, thinking, tool calls, and tool results. The selected source
block is marked in that context. The final `<question>` section is always last.
Dynamic parent content is never injected into the system prompt.

The prompt renderer is versioned so persisted consultation prompts remain
interpretable after future template changes.

## Consequences

### Positive

- The parent session file and context remain untouched.
- Child sessions can be resumed, navigated, exported, and deleted normally.
- The root sidebar stays compact while consultation history remains discoverable.
- The source excerpt remains available even if the parent is later compacted.
- The same AgentSession/SSE lifecycle can serve parent and child sessions.

### Negative

- Session scanning and deletion need explicit child-relation handling.
- A persisted child is physically a JSONL session and can be seen by tools that
  bypass Pi Web's hierarchy filter.
- Source entry IDs may become unavailable after parent deletion or migration;
  the stored prompt snapshot remains the fallback.
- Parent deletion must not silently re-parent consultation children. It needs an
  explicit cascade or detach policy.

## Alternatives rejected

### Forking the source session

Rejected because it copies history, changes the active session, and exposes the
result as a top-level session.

### Existing built-in subagent runtime

Rejected because it carries subagent-specific metadata, resource policies, and
parent-notification semantics. A consultation is a user-created persisted child
session, not a model-created delegated task.

### In-memory-only consultation

Rejected for the selected requirement because it cannot survive a page reload
or provide a durable child-session history.
