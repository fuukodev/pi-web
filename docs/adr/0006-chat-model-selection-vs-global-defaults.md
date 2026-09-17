# Chat model selection vs. pi's global defaults

Pi Web separates two things that used to be one setting: what a *session* runs
on, and what *pi* starts with.

The chat composer's model and thinking-level controls are **session-scoped**.
Selecting a model there passes `initialModel` into AgentSession construction
when the session is being created, or sends `set_model` to a live wrapper. Both
paths only append session entries. They never call
`SettingsManager.setDefaultModelAndProvider()` / `setDefaultThinkingLevel()`, so
`~/.pi/agent/settings.json` is unchanged.

Pi's **global** startup defaults are edited only from Settings → Models →
Defaults, which writes `defaultProvider` / `defaultModel` /
`defaultThinkingLevel` through `app/api/settings/route.ts` and
`lib/pi-settings.ts`.

## Why

Before this split, the composer's selection was persisted as pi's global default
whenever a session was created with an explicit model — but only on that path.
The same dropdown therefore had two different meanings depending on timing:

- **New session, wrapper not yet created** — the browser sent `provider`/`modelId`
  to `POST /api/agent/new`, which persisted the pair globally.
- **New session whose wrapper already existed** (the user had opened the
  System/Tools panel, loaded slash commands, or sent a prompt) — `set_model`,
  which does not persist.
- **Existing session** — `set_model`, which does not persist.

Three problems followed from that:

1. A per-chat control silently rewrote a file shared with the `pi` CLI and TUI,
   with no affordance, no confirmation, and no way to see or undo it from Pi Web.
2. Behaviour depended on invisible state. Whether the wrapper existed at
   selection time decided whether a global setting changed.
3. The tool-preset rebuild path passed the session's current model as
   `initialModel`, so merely switching tools on a fresh session could pin a new
   global default (plus `enabledModels` scope edits, which the SDK performs
   alongside a persisted default).

Removing the write also removes a second, subtler coupling: pi's TUI treats
"switch model" (Enter) and "save as default" (Ctrl+S) as separate explicit
actions. Pi Web has one control, so it can only honestly implement the first.

## Consequences

- A new session starts from pi's global default unless the browser picked a
  model or thinking level *for that session* before it was created. Pi Web no
  longer remembers the last composer selection; use Settings → Models →
  Defaults to change what new sessions start with.
- The defaults panel reports the **effective** model (`effectiveModel`) after
  `enabledModels` scope and provider auth are applied, because a saved default
  that is out of scope or unauthenticated is silently skipped at startup.
- Thinking-level support is judged on the **server** only. `GET /api/settings`
  and `PUT /api/settings` both return `warnings` for the model the level applies
  to — the requested model, or the saved one when only the level changes. The
  panel renders them and never compares thinking-level lists itself; the list it
  fetches from `/api/models` only fills the select's options.
- Thinking levels are advisory, never blocking: pi clamps per model at session
  start, and a saved default that no longer resolves (removed provider, expired
  auth) must not turn a legitimate level change into an error. Warnings skip that
  case instead.
- Pi Web is not the only writer of `settings.json`: the PowerShell tool setting
  (`defaultTools`), package management, and the `pi` CLI/TUI all write it too.
  The SDK `SettingsManager` is used here for its shared lock and field-level
  merge, so concurrent writers do not clobber each other.
