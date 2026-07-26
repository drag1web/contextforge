# Security Policy

## Supported versions

ContextForge is currently an alpha project. Security fixes are applied to the latest published alpha line only.

| Version | Supported |
| --- | --- |
| 0.7.x alpha | Yes |
| Earlier alpha versions | No |

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose source code, local paths, credentials, tokens, MCP permissions, Desktop Link credentials, or unsafe Task Pack authorization.

Use the repository's **GitHub Security Advisory** reporting flow instead. Include:

- affected version or commit;
- reproducible steps;
- expected and actual behavior;
- whether secrets, local files, Git state, MCP tools, or external integrations are involved;
- a minimal proof of concept that does not contain real credentials or private source code.

## Security boundaries

ContextForge is designed around these boundaries:

- project source remains local unless the user explicitly starts an external workflow;
- GitHub and website account integrations are optional;
- MCP is local stdio and read-only by default;
- Task Pack creation through MCP requires explicit global and per-call authorization;
- diagnostics must not persist raw prompts, model responses, source snippets, secrets, or absolute local paths;
- automatic repository edits, shell execution, Git mutation, and pull-request creation are outside the current product scope.
