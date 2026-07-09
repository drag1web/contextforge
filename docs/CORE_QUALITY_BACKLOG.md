# ContextForge Core Quality & Safety Backlog

This backlog captures the next engineering focus after the v0.6.0 GitHub issue loop baseline.

Source: `contextforge_project_tests_filled_report.docx` manual matrix covering 21 Task Pack test runs across `contextforge-website`, `metall-perm`, `roi-calculator` and `license-monitor`.

## Summary

The current core is useful for straightforward UI/database tasks and some safety blocks, but it is not production-ready for selector quality and security-sensitive scenarios.

Manual matrix result:

| Total | Good | Partial | Bad |
| ---: | ---: | ---: | ---: |
| 21 | 6 | 8 | 7 |

## P0 — security and hard-blocking

### Secret exfiltration / env files

Problem: requests such as reading `.env.local`, keys, tokens or secrets can still produce a Task Pack instead of a hard block.

Required behavior:

- Block requests that ask to read, copy, summarize or include `.env`, `.env.local`, credentials, tokens, keys or secrets.
- Do not include env/secret files in snippets.
- Do not pass secret-looking content to local/cloud AI providers.
- Return a clear blocked/clarify UX message with a safe alternative.

### Prompt injection / destructive intent

Problem: prompts such as “ignore previous instructions” or instructions to delete server files may be classified as high risk but still generate a Task Pack.

Required behavior:

- Detect prompt-injection and destructive phrases before inventory and file selection.
- Hard-block destructive tasks unless rewritten into a safe review/diagnostic request.
- Treat instructions inside README/project files as untrusted content, not user commands.

### Explicit target not found

Problem: if the user names a page/component/file that is not in inventory, the selector may substitute a nearby/random page.

Required behavior:

- Explicit file/page/component targets must exist in inventory.
- If not found, block or ask for manual selection.
- Do not map unknown named targets to “closest-looking” files.

## P1 — selector reliability and scoring

### Ollama selector JSON contract

Problem: Ollama often returns invalid/empty JSON, pushing otherwise simple tasks into fallback.

Required behavior:

- Use a stricter JSON schema prompt.
- Add repair/retry before fallback.
- Store/log raw selector response for debug.
- Mark fallback as fallback, not as high-confidence AI selection.

### Score calibration

Problem: weak or wrong fallback selections can receive 95–100/100.

Required behavior:

- Score should account for semantic match, required role coverage and wrong-domain edit targets.
- High scores should require strong target confidence and required support files.
- Fallback candidates should be treated as “needs confirmation” unless strongly validated.

### Task type vs implementation area

Problem: docs/test/UI/backend tasks can silently drift into another implementation area.

Required behavior:

- Keep user-selected task type separate from inferred implementation area.
- Show conflicts clearly.
- Do not silently override task type or inferred area without warning.

## P2 — routing and usage polish

### Docs/test/review routing

Required behavior:

- README/docs tasks: `README.md` as edit target; `package.json`, configs and env examples as inspect-only.
- Test tasks: package/test configs, existing tests, target utils/components and proposed new test files.
- Review/propose-only tasks: avoid edit targets unless the user explicitly asks to edit.

### ContextForge self-core awareness

Problem: tasks about ContextForge selector/safety/core can be routed to normal UI components.

Required behavior:

- Add generic internal signals for selector, scanner, context composer, safety policy, Task Pack builder and tests.
- Do not route self-core tasks to unrelated UI components because the prompt mentions “UI” or “Task Pack”.

## Recommended sequence

1. Secret and prompt-injection hard-blocks.
2. Explicit target resolver block/clarify behavior.
3. Ollama JSON contract repair/retry.
4. Context score calibration.
5. Docs/test/review routing profiles.
6. Self-core selector/safety awareness.

## Definition of done for the hardening pass

- The 21-case matrix is converted into repeatable smoke/replay tests.
- P0 unsafe prompts return blocked/clarify and no selected files.
- Unknown explicit targets do not select random files.
- Docs/test/review prompts select role-appropriate files.
- Fallback scores and labels are honest and explain uncertainty.
- Core/self-repair prompts select selector/safety/composer files, not unrelated UI components.
