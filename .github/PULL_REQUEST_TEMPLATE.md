# Summary

<!-- Briefly describe the outcome and why it is needed. -->

## Scope

- Area:
- Files / modules:
- Out of scope:

## Verification

List the commands and manual checks you actually ran. Leave unchecked anything that was not actually verified.

- [ ] `npm run build`
- [ ] Relevant focused smoke tests
- [ ] `git diff --check`

Additional verification:

<!-- Add exact commands and results, or write "None" if no additional verification was performed. -->

## Safety / privacy impact

Does this change affect local source handling, secrets or credentials, absolute local paths, MCP permissions, GitHub/Desktop Link/external providers, Task Pack authorization, or Context Engine grounding/authorization?

<!-- Describe the impact and safeguards. "None" is acceptable when truly unaffected. -->

## UI changes

<!-- If user-visible UI behavior changed, include screenshots. Otherwise write "None". -->

## Checklist

- [ ] The change is focused and avoids unrelated refactors.
- [ ] No secrets or private validation data were added.
- [ ] Documentation was updated when behavior or contracts changed.
- [ ] Tests and checks are reported accurately.
- [ ] CE2 changes, if any, follow the engine roadmap and preserve fail-closed behavior.
