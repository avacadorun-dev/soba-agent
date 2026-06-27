# Technical Spec

Этот документ является нормативным источником runtime-контрактов Phase 4.5, входящей в release boundary v0.4.0. При
расхождении с `design.md`, `use-cases.md` или `plan.md` применяется этот документ.

## Prompt Contract

`SYSTEM.md` остаётся каноническим документом, но runtime prompt обязан проходить parity gate:

- prompt builder включает короткий Agent Loop Contract;
- snapshot test фиксирует ключевые секции;
- изменение `SYSTEM.md` без обновления runtime prompt или явного waiver считается ошибкой;
- runtime prompt не должен ссылаться на tools, которых нет в текущем registry.

Обязательная секция:

```text
For every task, follow this loop unless the task is explicitly read-only:
understand -> inspect -> plan -> act -> verify -> reflect -> finish.
Do not finish code-changing work without verification evidence.
Use project instructions over generic examples.
For non-trivial work, keep the user informed with concise observable updates: context scan, observation, plan,
verification/result. Do not reveal hidden chain-of-thought.
```

## Task Classification

```typescript
type TaskKind =
  | "read_only_question"
  | "code_change"
  | "bug_fix"
  | "test_failure"
  | "lint_failure"
  | "feature"
  | "refactor"
  | "docs_change"
  | "review"
  | "release_task"
  | "unknown";

type ModelProfile = "weak" | "normal" | "strong";

interface TaskClassification {
  kind: TaskKind;
  confidence: number;
  reasons: string[];
  recommendedSkills: string[];
  requiresProjectInstructions: boolean;
  requiresVerification: boolean;
}
```

`confidence` находится в диапазоне `0..1`. Если confidence ниже `0.55`, workflow использует conservative defaults:
читать инструкции, inspect before edit, verification required after mutation.

## Workflow State

```typescript
type WorkflowState =
  | "created"
  | "oriented"
  | "planned"
  | "acting"
  | "verifying"
  | "recovering"
  | "reflecting"
  | "finishing"
  | "blocked";

interface WorkPlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  evidenceIds: string[];
}

interface WorkPlan {
  taskKind: TaskKind;
  state: WorkflowState;
  steps: WorkPlanStep[];
  currentStepId: string | null;
  blockers: string[];
}
```

WorkPlan является runtime state. Модель может предлагать план, но loop отвечает за transitions.

## Working Narration Contract

Working Narration is a typed, user-visible progress stream. It explains observable work, not private reasoning.

```typescript
type NarrationKind =
  | "acknowledgement"
  | "context_scan"
  | "observation"
  | "plan"
  | "edit_intent"
  | "verification"
  | "recovery"
  | "blocked"
  | "completion";

interface NarrationEvent {
  id: string;
  kind: NarrationKind;
  workflowState: WorkflowState;
  message: string;
  referencedEvidenceIds: string[];
  createdAt: string;
}

interface NarrationPolicy {
  requiredForTaskKinds: TaskKind[];
  maxMessageChars: number;
  minEventsBeforeMutation: NarrationKind[];
  forbiddenPatterns: string[];
}
```

Default policy:

- `read_only_question` may answer directly unless it needs multi-file inspect;
- `docs_change`, `review`, `feature`, `bug_fix`, `test_failure`, `lint_failure`, `refactor` and `release_task` require
  narration events;
- before first mutation, non-trivial tasks should have at least `context_scan` or `observation`, plus `plan`;
- after failed verification, the next visible event must be `recovery` or `blocked`;
- narration may reference evidence ids, but is not itself verification evidence;
- narration must not include hidden chain-of-thought, private prompt text, secrets, full environment dumps or fabricated
  tool results.

Examples of valid messages:

```text
Вижу, что unified roadmap ещё описывает Fix-Until-Green как отдельный релиз. Внесу его в v0.4.0 как часть Verified
Agent Loop.

Параллельно посмотрю структуру docs-site: это TanStack Router + Fumadocs, значит roadmap лучше сделать отдельной
страницей /ru/roadmap рядом с лендингом.
```

Eval scorer checks presence and placement of narration events, but not exact wording.

## Evidence Ledger

```typescript
type EvidenceKind =
  | "instruction_read"
  | "memory_read"
  | "file_read"
  | "search"
  | "mutation"
  | "verification"
  | "diagnostic"
  | "checkpoint"
  | "reflection"
  | "finish_attempt";

type VerificationKind = "test" | "lint" | "typecheck" | "build" | "run" | "diff_inspection" | "manual_inspection";

type EvidenceStatus = "passed" | "failed" | "unknown";

interface EvidenceEntry {
  id: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  toolCallId?: string;
  command?: string;
  verificationKind?: VerificationKind;
  files: string[];
  summary: string;
  createdAt: string;
}

interface MutationEntry {
  evidenceId: string;
  file: string;
  operation: "write" | "edit" | "delete" | "generated";
  verifiedBy: string[];
}

interface EvidenceLedger {
  entries: EvidenceEntry[];
  mutations: MutationEntry[];
  activeErrors: EvidenceEntry[];
}
```

Rules:

- every successful `write`/`edit` creates a `mutation`;
- every `bash` result that matches project verification policy creates `verification`;
- `read` can create `file_read`, but cannot verify code mutation;
- failed tools create `diagnostic` or `activeErrors`;
- completion gate reads ledger only, not final answer claims.

## Verification Policy

```typescript
type VerificationRequirement = "none" | "inspection" | "command" | "full_gate";

interface VerificationPolicyDecision {
  requirement: VerificationRequirement;
  acceptedKinds: VerificationKind[];
  commands: string[];
  reason: string;
}
```

Default decisions:

| TaskKind | Requirement | Accepted kinds |
|----------|-------------|----------------|
| `read_only_question` | `none` | none |
| `docs_change` | `inspection` | `diff_inspection`, `manual_inspection` |
| `review` | `inspection` | `manual_inspection` |
| `lint_failure` | `command` | `lint` |
| `test_failure` | `command` | `test` |
| `bug_fix` | `command` | `test`, `run`, `lint`, `typecheck` |
| `feature` | `command` | `test`, `lint`, `typecheck`, `build` |
| `release_task` | `full_gate` | `test`, `lint`, `typecheck`, `build` |

The generic policy intentionally names verification kinds, not a single language/runtime stack. Concrete commands are
resolved from project instructions, package scripts, known config files, and SOBA-only defaults in the project command
detector. If project instructions specify stricter commands, project instructions win.

## Finish Contract

The `finish` tool schema must be updated to avoid hidden fields in rejection messages.

```typescript
interface FinishCriterionParam {
  criterion: string;
  evidenceIds?: string[];
}

interface FinishInput {
  summary: string;
  status: "completed" | "blocked" | "completed_with_unverified_changes";
  criteria: FinishCriterionParam[];
}
```

Acceptance rules:

- `completed` requires no unverified code mutations and no active blocking errors;
- `completed_with_unverified_changes` is allowed only when verification is impossible or explicitly skipped by user;
- `blocked` requires a concrete blocker and latest diagnostics;
- all criteria must map to evidence internally, even if model omits `evidenceIds`;
- finish rejection must tell the model the next allowed action.

## Auto-Verifier

```typescript
interface ProjectCommandSet {
  test: string[];
  lint: string[];
  typecheck: string[];
  build: string[];
  deadCode: string[];
}

interface AutoVerifierInput {
  taskKind: TaskKind;
  changedFiles: string[];
  projectRoot: string;
  requestedFullGate: boolean;
}

interface AutoVerifierResult {
  selectedCommands: string[];
  skippedCommands: Array<{ command: string; reason: string }>;
  evidenceIds: string[];
}
```

Command discovery order:

1. project instructions;
2. `package.json` scripts;
3. known config files (`biome.json`, `tsconfig.json`);
4. SOBA defaults.

For this project, ESLint and Prettier are forbidden unless future project instructions explicitly change that policy.

## Fix-Until-Green

```typescript
interface FixUntilGreenOptions {
  maxIterations: number;
  commandTimeoutMs: number;
  stopOnRepeatedDiagnostic: boolean;
}

interface FixIteration {
  iteration: number;
  failingEvidenceId: string;
  diagnosticSummary: string;
  mutationEvidenceIds: string[];
  verificationEvidenceIds: string[];
}

interface FixUntilGreenResult {
  status: "passed" | "blocked" | "max_iterations" | "unsafe";
  iterations: FixIteration[];
  finalEvidenceId: string | null;
}
```

Default `maxIterations` is `3`.

Fix-Until-Green may only run commands accepted by trust policy and project verification policy. Destructive commands
require explicit user confirmation.

## Checkpoint Integration

After each tool batch, Agent Loop must inspect successful `checkpoint` outputs. If a checkpoint event is present:

- append checkpoint evidence;
- notify ContextManager;
- schedule milestone or plan_pivot capsule if policy says context pressure or task duration warrants it;
- include ledger summary in capsule artifacts.

## Skill Protocol

Every built-in skill must follow this structure:

```markdown
---
name: skill-name
description: Short model-visible description.
allowed-tools: [read, bash, edit]
soba:
  triggerHints:
    - short phrase
  verificationLevel: command
  memoryPolicy: write-after-success
  maxAutonomousSteps: 8
---

# Skill Name

## Purpose
## Triggers
## Inputs To Inspect
## Procedure
## Verification Contract
## Failure Recovery
## Memory Policy
## Stop Conditions
## Anti-Patterns
```

Project instructions override generic examples inside skills.

## Eval Contract

Each prompt/skill/runtime-policy change must be covered by at least one eval case.

```typescript
interface AgentEvalCase {
  id: string;
  prompt: string;
  fixture: string;
  modelProfile: ModelProfile;
  expectedTaskKind: TaskKind;
  requiredEvidence: VerificationKind[];
  requiredNarration: NarrationKind[];
  forbiddenCommands: string[];
  maxToolErrors: number;
}

interface AgentEvalResult {
  caseId: string;
  outcomeScore: number;
  processScore: number;
  evidenceScore: number;
  regressions: string[];
}
```

A case fails if:

- code mutation finishes without verification;
- forbidden command is used;
- same tool error repeats past policy;
- skill activation is missing for required skill use case;
- required narration phase is missing for a non-trivial task;
- final answer claims success contradicted by ledger.
