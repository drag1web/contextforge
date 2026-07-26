# ContextForge MCP Server

ContextForge MCP is a local Model Context Protocol server that exposes verified ContextForge project records, enabled Project Memory, and saved Task Packs to coding clients such as Codex. It runs as a child process over stdio and uses the same storage and guarded Task Pack pipeline as the desktop backend.

MCP is not **Run in Codex**. MCP lets a client discover and call ContextForge tools, resources, and prompts. It does not launch a Codex task, control the Codex App Server, edit source files, run shell commands, or mutate Git.

## Current capabilities

The v1 server exposes these tools:

- `contextforge_list_projects`
- `contextforge_get_project_overview`
- `contextforge_list_project_memory`
- `contextforge_list_task_packs`
- `contextforge_get_task_pack`
- `contextforge_create_task_pack`
- `contextforge_explain_task_pack`

It exposes these resources and templates:

- `contextforge://projects`
- `contextforge://projects/{projectId}`
- `contextforge://projects/{projectId}/memory`
- `contextforge://projects/{projectId}/task-packs`
- `contextforge://task-packs/{taskPackId}`

It exposes these workflow prompts:

- `contextforge_prepare_implementation`
- `contextforge_prepare_bugfix`
- `contextforge_prepare_investigation`
- `contextforge_prepare_code_review`

All tools return a structured envelope with `ok`, `operation`, bounded `data`, `warnings`, and provenance. List operations report counts and truncation metadata. Stable failures use `MCP_*` error codes and do not return raw stack traces, SQL, environment values, or credentials.

## Permissions and local-first boundary

The MCP server is read-only by default:

- registered Project records can be read;
- enabled Project Memory can be read;
- saved Task Packs can be read;
- full Task Pack prompts are omitted from list operations;
- absolute local project paths are omitted unless a supported operation explicitly requests one;
- secret-like paths and credential-shaped fields are redacted.

`contextforge_create_task_pack` is the only write operation. It writes a new Task Pack to ContextForge storage only when both conditions are true:

1. `CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS=true` or the matching desktop permission is enabled;
2. the individual tool call contains `confirmCreate: true`.

Creation runs the same Task Pack pipeline as `POST /api/task-packs`. It preserves clarification, context selection, ownership, grounding, quality, and authorization guards. It does not write repository files, execute commands, or change Git.

MCP audit events contain operation names, safe IDs, status, and timestamps. They do not contain the full task, generated prompt, snippets, secrets, or provider keys. Stdio reserves stdout for JSON-RPC; diagnostics and audit events use stderr.

## Database path

An MCP client may start the server from any working directory. ContextForge therefore resolves its default data path relative to the application installation, not `process.cwd()`.

Resolution order for SQLite is:

1. `SQLITE_DB_PATH`;
2. `<CONTEXTFORGE_DATA_DIR>/contextforge.sqlite`;
3. the application-root development fallback `data/contextforge.sqlite`.

Relative development values in the repository `.env` are resolved from the ContextForge application root. For a production registration, prefer an absolute `SQLITE_DB_PATH`. MCP startup refuses to create a silent replacement database when the configured SQLite file does not exist.

PostgreSQL continues to use `STORAGE_DRIVER=postgres` and `DATABASE_URL`.

## Development run

From the repository root:

```powershell
npm install
npm run mcp:dev
```

The exact server-workspace equivalent is:

```powershell
npm run mcp:dev -w @contextforge/server
```

The process waits for MCP JSON-RPC on stdin. It is not an interactive terminal program and does not print a startup banner to stdout.

## Production/built run

From the repository root:

```powershell
npm run build
npm run mcp:start
```

The built entrypoint is:

```text
server/dist/mcp/index.js
```

The desktop Integrations workspace reports `Needs build` until this file exists.

## Codex CLI setup

Build the server first, then use the command generated in **Integrations → Local MCP**. Its paths are derived from the current installation and quoted for the current platform.

Generic form:

```powershell
codex mcp add contextforge --env STORAGE_DRIVER=sqlite --env "SQLITE_DB_PATH=<absolute-path-to-contextforge.sqlite>" -- node "<absolute-path-to-contextforge>/server/dist/mcp/index.js"
```

After registration, restart or reload Codex and verify the server:

```powershell
codex mcp list
```

In Codex interactive surfaces, `/mcp` shows connected servers. Codex stores MCP configuration in `config.toml`; its CLI, IDE extension, and desktop app share that configuration. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

ContextForge does not run this command or modify Codex configuration automatically.

## Manual config.toml setup

Add a block like this to `~/.codex/config.toml`, or to a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.contextforge]
enabled = true
command = "node"
args = ["<absolute-path-to-contextforge>/server/dist/mcp/index.js"]
env = { "STORAGE_DRIVER" = "sqlite", "SQLITE_DB_PATH" = "<absolute-path-to-contextforge.sqlite>" }
startup_timeout_sec = 15.0
tool_timeout_sec = 120.0
```

On Windows, TOML basic strings require escaped backslashes, for example `C:\\ContextForge\\server\\dist\\mcp\\index.js`. The generated desktop snippet applies the required escaping automatically.

## Desktop controls

Open **Integrations → Local MCP** to:

- enable or disable the local server;
- keep Task Pack creation disabled or explicitly opt in;
- inspect built entrypoint and database readiness without displaying the database path as a status field;
- copy the generated `codex mcp add` command or `config.toml` block;
- run a real initialize/list-tools/list-resources/list-prompts handshake.

The connection test starts a child process with a timeout and closes it in all success and failure paths. It never creates a Task Pack or changes global Codex configuration.

## MCP Inspector

Build the server and run:

```powershell
npm run mcp:inspect -w @contextforge/server
```

The command uses the official MCP Inspector through `npx` and targets the built stdio entrypoint. Configure the same `SQLITE_DB_PATH` environment value used by ContextForge before starting the inspector.

## Troubleshooting

### `MCP_BUILD_REQUIRED` or `Needs build`

Run `npm run build` and confirm that `server/dist/mcp/index.js` exists.

### `MCP_DATABASE_NOT_FOUND` or `MCP_STORAGE_UNAVAILABLE`

Start ContextForge once to initialize its normal database, or set `SQLITE_DB_PATH` to the existing absolute SQLite file. The MCP process intentionally refuses to create a new database in an arbitrary working directory.

### Server is disabled

Enable it in **Integrations → Local MCP**, or set:

```text
CONTEXTFORGE_MCP_ENABLED=true
```

An explicit environment value overrides the stored desktop setting.

### Task Pack creation is denied

Enable **Create Task Packs** in the MCP permission panel or set:

```text
CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS=true
```

The client must still send `confirmCreate: true`. Blocked selection and required clarification cannot be bypassed.

### Windows paths contain spaces

Use the generated command. If writing one manually, quote each path argument separately. In TOML, escape backslashes inside double-quoted strings.

### Connection test times out

Check that the database exists, the built entrypoint is current, and no ordinary logs are written to stdout. Run `npm run test:mcp` for the isolated stdio, shutdown, discovery, permissions, and fixture-storage checks.

## Remove the Codex registration

```powershell
codex mcp remove contextforge
```

Removing the registration does not delete ContextForge data or settings.

## Known limitations

- v1 supports local stdio only; there is no remote HTTP transport, OAuth, or cloud hosting.
- Git summaries are returned only when already stored; MCP does not trigger a new expensive Git analysis.
- older Task Packs may not contain every modern selection or confidence field; `contextforge_explain_task_pack` reports those fields as unavailable.
- the production Codex command requires a built server entrypoint.
- PostgreSQL registration may require manually forwarding `DATABASE_URL` rather than placing credentials in copied UI text.
- MCP does not implement Run in Codex or Codex App Server task orchestration.

Future Run in Codex/App Server work can build on the same Task Pack service, but must remain a separate explicit execution and authorization surface.
