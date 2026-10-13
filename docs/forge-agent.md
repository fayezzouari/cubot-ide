# Forge — the coding agent in the IDE

Forge is the agent in the right-hand panel of the code editor. It is the same
backend that used to answer as "AI Assistant", rebuilt around three ideas:

1. **Show the work.** Every tool call streams to the panel as it happens, so a
   30-second turn reads as *Reading → Editing → Compiling → Build passed* instead
   of a spinner.
2. **Verify before claiming.** Forge compiles after it edits and fixes its own
   errors. The system prompt forbids reporting success without a passing build.
3. **Stay reversible.** Every file change carries the previous content, so the
   user can revert one change without touching the rest.

The agent's display name lives in `frontend/lib/branding.ts` and the persona
name in `backend/services/ai_service.py` (`AGENT_NAME`). Change both to rename it.

## One turn

```
IDE panel ──POST /api/chat/{project}/stream──► ai_service.chat_stream
                                                   │
          ◄── status / tool_start / tool_end ──── agentic loop (Bedrock invoke_model)
          ◄── done {message, file_operations} ◄──   └─ tools_functions.handle_tool_use
```

* `routes/chat.py` exposes `/stream` (server-sent events) next to the older
  blocking `POST /chat/{project}`. Both run `_run_chat`; the streaming variant
  feeds events through an `asyncio.Queue`, and closing the connection (the Stop
  button) cancels the loop.
* `_run_chat` builds the system prompt with a **project snapshot** (every file
  path with its line count, the open file marked) so the agent rarely needs a
  `list_files` round-trip, trims the conversation history to the last 12
  messages / 6 000 characters each, and merges consecutive same-role messages
  (Bedrock rejects them).
* `_converse_claude` / `_converse_openai` are the two model families Bedrock
  serves. Both share `_run_tool`, which executes the call, records file
  operations and command logs, and emits the timeline events. `invoke_model`
  runs in a worker thread so events keep flowing while the model thinks.
* Temperature is 0.2 (was 0.7): coding tasks want determinism.

### Events

| type | payload | panel shows |
| --- | --- | --- |
| `status` | `text` | "Thinking" / "Planning" in the live header |
| `tool_start` | `id, tool, label, detail` | a running row: *Editing `main.cpp`* |
| `tool_end` | `… ok, summary, file_op, log` | the row resolves; compile/sandbox output expands |
| `done` | `message, file_operations, execution_logs` | the answer and the changed-files card |
| `error` | `message` | a red error block |

## Tools

| tool | when | notes |
| --- | --- | --- |
| `list_files` | paths changed during the turn | snapshot in the prompt covers the start |
| `read_file` | before editing a file not already in context | |
| `edit_file` | **preferred** for changes | exact-span replace; must match once. Falls back to a whitespace-insensitive line match, keeping the file's indentation. Refuses ambiguous matches. |
| `update_file` | rewrites that touch most of a file | |
| `create_file` | new files | fails if the path exists |
| `compile_project` | embedded targets (Arduino, ESP32, TI ARM) | runs the project's compiler image; returns errors (max 25) and the output tail |
| `execute_in_sandbox` | ROS projects with a live workspace | |
| `search_web` | when the user turned web search on | Exa |

Every file tool returns `operation, path, file_id, summary, added, removed,
previous_content`. `previous_content` is stripped before the result goes back to
the model (`result_for_model`) and kept for the client, which reverts by
writing it back (or deleting a created file). Tool output is capped at 6 000
characters so one noisy build cannot flood the context.

## Modes

* **Build** (`plan_mode=false`): the full loop above, up to 30 model turns.
* **Plan** (`plan_mode=true`): one completion with the plan prompt and the
  conversation history, no tools. The client parses `**Step N: Title**` blocks
  into cards; *Run step* calls `/execute-step`, which runs the Build loop scoped
  to that step (20 turns). Plan and Build keep separate histories; messages are
  stored with their `mode`, so reloading the IDE restores both.

## Frontend

`frontend/components/ide/agent/`

The panel is drawn in a pixel-art theme: Silkscreen for labels, VT323 for
running text, hard 2px notched borders (`.pixel-border`, a box-shadow trick),
stepped animations and faint scanlines. Tokens (`--color-forge-*`, the two
font faces) and the utilities live in `app/globals.css` under the Tailwind v4
`@theme`; the faces are loaded in `app/layout.tsx`.

* `agent-panel.tsx` — header, conversation, empty state with quick prompts.
* `agent-composer.tsx` — input, context chips (open file toggle + pinned
  selections), Build/Plan switch, web search, send/stop (Esc stops).
* `activity-timeline.tsx` — the per-turn tool timeline; collapses to one line
  when the turn is over.
* `file-change-card.tsx` — changed files with +/− counts, open and revert.
* `plan-step-card.tsx` — a plan step with run/skip and its execution result.

The IDE page (`app/ide/page.tsx`) owns the state: it streams the turn,
refreshes the editor as each `file_op` lands, and exposes *Fix with Forge* from
the compile dialog, which sends the compiler errors as a Build-mode message.
