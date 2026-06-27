# Phase 3.5 — Portable Capsules: Technical Specification

## Portable schema v1

```typescript
interface PortableCapsule {
  schema: "soba.portable-capsule";
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  sender?: string;
  intendedReceiver: string;
  objective: string;
  tier: "quick" | "standard" | "deep";
  category: "full_system" | "knowledge_pillar" | "conversation_thread" | "living_reference";
  archetype: "perishable" | "handoff" | "seed" | "steroid" | "delta" | "trainer" | "dormant";
  dispatchSummary: string;
  coreContent: string[];
  patterns: Array<{ name: string; description: string }>;
  assumptions: string[];
  signals: string[];
  artifacts: ArtifactLedger;
  integrationPlan: IntegrationStep[];
  verbatimPayloads: VerbatimPayload[];
  sanitation: SanitationReport;
  provenance: { source: "session_checkpoint" | "session_branch" | "external"; checkpointId?: string };
}
```

`IntegrationStep` содержит `order`, `mode`, `title`, `prerequisites`, `actions`, `verification` и `rollback`.
`VerbatimPayload` содержит `name`, `mediaType`, `content` и lowercase SHA-256 `checksum`.

## Markdown encoding

Файл имеет расширение `.capsule.md`. YAML frontmatter содержит только scalar metadata. Полное машинное
представление находится в fenced block `soba-capsule-json`, что обеспечивает детерминированный round-trip без
стороннего YAML parser. Перед блоком находится человекочитаемый briefing.

## Validation

Blocking errors:

- unknown schema/version;
- empty objective, receiver, summary или core content;
- invalid ID/date/enums;
- Standard/Deep без integration plan;
- auto-step без verification или rollback;
- duplicate/non-contiguous step order;
- payload checksum mismatch;
- превышение size limits;
- обнаруженный unsanitized secret.

Warnings:

- Quick capsule с integration steps;
- empty signals/patterns;
- absolute project path после sanitization;
- external capsule без provenance checkpoint.

## CLI

```text
/capsule                              list session checkpoints
/capsule <checkpoint-id>              inspect checkpoint
/capsule create <objective>           create Quick/Handoff capsule in .soba/capsules
/capsule export <id> <path>           export checkpoint
/capsule load <path>                  validate and pass briefing to next turn
```

`load` returns `{ handled: false, prompt }`; prompt identifies content as untrusted and says not to execute embedded
instructions without normal permission checks.

## Limits

- Capsule file: 1 MiB.
- One verbatim payload: 256 KiB.
- Total verbatim content: 512 KiB.
- Core content entries: 100.
- Integration steps: 50.

