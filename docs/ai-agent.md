# The AI assistant: the coding agent in the IDE

The assistant in the right-hand panel of the code editor is an agent built
around three ideas:

1. **Show the work.** Every tool call streams to the panel as it happens, so a
   30-second turn reads as *Reading → Editing → Compiling → Build passed* instead
   of a spinner.
2. **Verify before claiming.** The agent compiles after it edits and fixes its own
   errors. The system prompt forbids reporting success without a passing build.
3. **Stay reversible.** Every file change carries the previous content, so the
   user can revert one change without touching the rest.

The display name and mode labels live in `frontend/lib/branding.ts`, the
persona name in `backend/services/ai_service.py` (`AGENT_NAME`).

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
* The model is called with `invoke_model_with_response_stream`; the stream is
  reassembled into the usual response shape (text blocks, tool calls) while
  every text delta goes out as a `text_delta` event. Models that emit their
  chain of thought as `<reasoning>` text have it filtered live and on save.
  If the streaming API is refused, the call falls back to one shot.
* Temperature is 0.2 (was 0.7): coding tasks want determinism.
* Prompt rules: fix every occurrence of a problem, not only the first; never
  add code comments unless asked; say when a build could not be verified.
  After `edit_file` the tool result echoes the whole file (up to 300 lines)
  so the model re-reads what it just changed.

### Events

| type | payload | panel shows |
| --- | --- | --- |
| `thread` | `thread_id` | the conversation the turn is saved in |
| `status` | `text` | "Thinking" / "Planning" in the live header |
| `text_delta` | `text` | the answer, token by token, rendered as markdown while it streams |
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

## Conversations

Messages belong to a thread (`chat_threads` collection; `thread_id` on each
message). A project has many threads; the panel header shows the active one,
`+` starts a new one and the clock icon lists past chats with rename and
delete. The thread is created on the server with the first message of a new
chat and titled from that message; the stream announces it in a `thread`
event. Messages saved before threads existed are adopted into one thread named
"Earlier conversation" the first time the list is requested.

```
GET    /api/chat/{project}/threads              list, most recent first
POST   /api/chat/{project}/threads              create (optional title)
PUT    /api/chat/{project}/threads/{thread}     rename
DELETE /api/chat/{project}/threads/{thread}     delete with its messages
GET    /api/chat/{project}/history?thread_id=   messages of one thread
```

The IDE remembers the last open thread per project in localStorage.

## Modes

* **Vibe** (`plan_mode=false`, `build` in code): the full loop above, up to 30 model turns.
* **Plan** (`plan_mode=true`): one completion with the plan prompt and the
  conversation history, no tools. The client parses `**Step N: Title**` blocks
  into cards; *Run step* calls `/execute-step`, which runs the Vibe loop scoped
  to that step (20 turns). Both modes share one thread; each message is stored
  with its `mode`.

## Frontend

`frontend/components/ide/agent/`


* `agent-panel.tsx` — header with thread title, new chat and history popover,
  conversation, empty state with quick prompts.
* `agent-composer.tsx` — input, context chips (the open file, always sent,
  plus pinned selections), mode menu, web search, send/stop (Esc stops).
* `activity-timeline.tsx` — the per-turn tool timeline; collapses to one line
  when the turn is over.
* `file-change-card.tsx` — changed files with +/− counts, open and revert.
* `plan-step-card.tsx` — a plan step with run/skip and its execution result.

The IDE page (`app/ide/page.tsx`) owns the state: it streams the turn,
refreshes the editor as each `file_op` lands, and exposes *Fix with AI* from
the compile dialog, which sends the compiler errors as a Vibe-mode message.
