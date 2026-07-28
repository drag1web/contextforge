# Codex Execution Protocol — Context Engine v2

**Project:** ContextForge<br>
**Purpose:** Safe staged implementation of CE2 work orders

---

## 1. Operating model

Codex is the implementation agent, not the architecture owner.

Codex may:

- inspect the repository;
- read the complete architecture package;
- implement the assigned work order;
- add focused tests;
- run builds and validation commands;
- report uncertainties and limitations;
- recommend a follow-up item without implementing it.

Codex may not:

- broaden scope without explicit approval;
- redesign core contracts silently;
- implement later work orders early;
- add project-specific exceptions to generic engine code;
- alter legacy behavior outside the assigned stage;
- suppress failing tests or rewrite expectations without justification;
- claim completion without showing verification evidence.

---

## 2. One-work-order rule

Every Codex session receives exactly one primary work order, for example:

```text
CE2-00 — Boundary, Contracts, and Architecture Guard
```

The full package is reference context. It is not permission to implement all later stages.

When Codex encounters a dependency on a later stage, it should:

1. define the smallest interface or placeholder permitted by the current work order;
2. document the deferred requirement;
3. stop at the current boundary.

---

## 3. Required preparation

Before editing, Codex must:

1. read `docs/context-engine-v2/README.md`;
2. read CE-01 through CE-06;
3. read the assigned CE2 work order in CE-07;
4. inspect `AGENTS.md` and relevant repository instructions;
5. inspect current `git status` and branch;
6. identify pre-existing uncommitted changes;
7. avoid modifying unrelated pre-existing work;
8. identify current test/build scripts before adding new ones.

Codex should report any mismatch between the architecture package and repository reality before making an incompatible assumption.

---

## 4. Ready-to-use initial prompt for CE2-00

```text
You are implementing Context Engine v2 in the ContextForge repository.

Read these files as binding architecture constraints:
- docs/context-engine-v2/README.md
- docs/context-engine-v2/CE-01_Current_Architecture_Audit.md
- docs/context-engine-v2/CE-02_Repository_Knowledge_Model_and_Evidence_Schema.md
- docs/context-engine-v2/CE-03_Investigation_Loop_and_Stop_Policy.md
- docs/context-engine-v2/CE-04_Component_Boundaries_Ports_and_Dependency_Rules.md
- docs/context-engine-v2/CE-05_Legacy_Compatibility_Shadow_Migration_and_Rollout.md
- docs/context-engine-v2/CE-06_Validation_and_Quality_Model.md
- docs/context-engine-v2/CE-07_Implementation_Roadmap_and_Codex_Work_Orders.md

Implement only:
CE2-00 — Boundary, Contracts, and Architecture Guard.

Hard constraints:
- Do not connect Context Engine v2 to production routes, Context Composer, Task Pack generation, or the legacy selector.
- Do not change legacy selection behavior.
- Do not add scoring, task-family exceptions, project-specific rules, or model integration.
- Keep contracts/domain/application dependency-neutral as defined in CE-04.
- Add architecture and contract smoke tests.
- Preserve all unrelated working-tree changes.

Before editing, inspect AGENTS.md, git status, package scripts, and relevant current types.

After implementation, run the required CE2-00 checks plus the server build. Do not hide failures.

Return exactly:
1. status: complete / partial / blocked;
2. changed files and purpose;
3. architecture decisions;
4. tests added or updated;
5. commands and exact results;
6. known limitations;
7. scope deviations;
8. git diff --check;
9. git diff --stat;
10. git status --short.

Stop after CE2-00. Do not start CE2-01.
```

---

## 5. Template for later work orders

Replace `<WORK_ORDER>` and stage-specific constraints:

```text
Continue Context Engine v2 implementation in ContextForge.

Read the complete architecture package under docs/context-engine-v2/ as binding context.

Implement only:
<WORK_ORDER from CE-07>

The previous accepted CE2 stages are baseline and may be used, but do not implement any later stage.

Hard constraints:
- Preserve legacy/product behavior unless this work order explicitly changes it.
- Do not add project-specific engine rules.
- Do not add model integration before CE2-10.
- Keep all lower-layer dependency rules from CE-04.
- Every accepted fact/finding must have provenance/evidence.
- Preserve contradictions and unresolved gaps truthfully.
- Preserve unrelated working-tree changes.

First inspect AGENTS.md, git status, existing stage implementation, and available scripts.

Run all work-order verification commands and relevant existing regression suites.

Return the required Codex report from CE-07 and stop at the work-order boundary.
```

---

## 6. Scope-control rules

Codex must classify any discovered issue as one of:

```text
A. required for current work order
B. pre-existing blocker
C. later-stage requirement
D. unrelated defect
```

Only category A is normally implemented.

For B/C/D, Codex reports:

- file/location;
- impact;
- recommended future stage;
- whether current work can continue safely.

Codex must not “clean up while here” across the repository.

---

## 7. Contract change protocol

If Codex believes a normative contract is internally inconsistent or impossible to implement:

1. stop before changing the contract;
2. cite the exact document section;
3. show the repository evidence creating the conflict;
4. propose the smallest amendment;
5. continue only if the change is backward-compatible and clearly marked, otherwise wait for architecture review.

Implementation convenience is not sufficient reason to weaken a contract.

---

## 8. Test discipline

Codex must:

- add tests before or with behavior;
- use generic fixtures;
- avoid network/model/database dependencies in core tests;
- run architecture guards after any import change;
- keep legacy regression tests intact;
- report skipped tests and why;
- never replace a meaningful assertion with a looser snapshot merely to pass.

Golden trace changes require:

- changed expectation;
- reason;
- before/after semantic difference;
- confirmation that safety did not regress.

---

## 9. Git discipline

Codex should not commit unless explicitly instructed.

Before editing:

```powershell
git branch --show-current
git status --short
```

After editing:

```powershell
git diff --check
git diff --stat
git status --short
```

Do not stage, restore, or delete unrelated user changes.

Do not add generated artifacts, local databases, `.env`, build output, or source ZIP files.

---

## 10. Dependency discipline

Prefer existing dependencies and standard library functionality.

A new dependency requires:

- why existing tools are insufficient;
- maintenance/security implications;
- production vs development classification;
- exact package change;
- test/build confirmation.

Do not add a graph database, vector store, agent framework, or model SDK during foundational stages.

---

## 11. Reporting failures

A failed command must be reported with:

- command;
- exit code if available;
- relevant error summary;
- whether failure is introduced, pre-existing, or environment-related;
- what was still verified.

Codex must not describe a stage as complete when required checks did not run unless the report clearly marks it partial and explains why.

---

## 12. Human handoff checklist

After Codex returns work, the reviewer should request or collect:

```text
git diff --check
git diff --stat
git status --short
relevant test output
server/renderer build output where required
```

For architecture-sensitive stages, also inspect:

- imports from `server/src/contextEngineV2/**`;
- generic fixture names/content;
- evidence and source-span construction;
- stop-policy behavior;
- whether legacy files were modified;
- whether later-stage functionality leaked in.

---

## 13. Definition of a good Codex result

A good result is:

- smaller than the work order boundary;
- easy to review;
- tested at the right layer;
- explicit about limitations;
- reversible;
- free of hidden architecture decisions;
- grounded in the supplied package and actual repository.

A large result that implements several stages at once is not better, even if it builds.
