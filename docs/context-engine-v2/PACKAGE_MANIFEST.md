# Package Manifest

| File | Purpose |
|---|---|
| `README.md` | Package overview, usage order, non-negotiable decisions |
| `QUICK_START_RU.md` | Краткая инструкция по передаче пакета Codex |
| `CE-01_Current_Architecture_Audit.md` | Current-state audit and migration justification |
| `CE-02_Repository_Knowledge_Model_and_Evidence_Schema.md` | Canonical domain and evidence model |
| `CE-03_Investigation_Loop_and_Stop_Policy.md` | Iterative engine behavior, budgets, operations, stopping |
| `CE-04_Component_Boundaries_Ports_and_Dependency_Rules.md` | Module layout, ports, dependency constraints |
| `CE-05_Legacy_Compatibility_Shadow_Migration_and_Rollout.md` | Legacy coexistence and rollout strategy |
| `CE-06_Validation_and_Quality_Model.md` | Validation layers, metrics, severity, release gates |
| `CE-07_Implementation_Roadmap_and_Codex_Work_Orders.md` | CE2-00 through CE2-11 implementation assignments |
| `CODEX_EXECUTION_PROTOCOL.md` | Ready-to-use Codex workflow and prompts |
| `CE2-11_LEGACY_RETIREMENT.md` | Implemented primary-authority readiness boundary and retained-legacy matrix |
| `IMPLEMENTATION_STATUS.md` | Current code-readiness versus external/physical-retirement status |
| `EXTERNAL_RETIREMENT_VALIDATION.md` | Private-project CLI, report metrics, gates, and observation workflow |
| `external-retirement-manifest.example.json` | Generic manifest shape; copy outside Git and replace the local root |
| `SHA256SUMS.txt` | Canonical-LF integrity checksums; verify with `npm run test:context-engine-v2:docs-integrity` |
