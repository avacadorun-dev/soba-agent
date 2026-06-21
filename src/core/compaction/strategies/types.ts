/**
 * Capsule strategy types.
 *
 * Defines the interface for capsule generation strategies and
 * shared types used across all strategies.
 *
 * Spec: internal-design-notes § Compaction Strategies
 */

import type { ItemParam } from "../../session/types";
import type {
  ActivatedSkillRef,
  ArtifactLedger,
  ContextCapsuleEntry,
  NativeContinuation,
  PortableContextState,ProviderCapabilities, ProviderIdentity 
} from "../../session/types-v2";
import type { ContextSnapshot } from "../context-meter";

// ─── Input ───

export interface CapsuleGenerationInput {
  sessionId: string;
  branchEntryIds: string[];
  sourceItems: ItemParam[];
  firstCompactedEntryId: string;
  firstKeptEntryId: string;
  trigger: import("../trigger-policy").CapsuleTrigger;
  customInstructions?: string;
  snapshotBefore: ContextSnapshot;
  provider: ProviderIdentity;
  capabilities: ProviderCapabilities;
  activatedSkills: ActivatedSkillRef[];
}

// ─── Draft ───

export interface ContextCapsuleDraft {
  strategy: ContextCapsuleEntry["strategy"];
  quality: ContextCapsuleEntry["quality"];
  portableState: PortableContextState;
  artifacts: ArtifactLedger;
  activatedSkills: ActivatedSkillRef[];
  nativeContinuation?: NativeContinuation;
  provenance: ContextCapsuleEntry["provenance"];
  metrics: ContextCapsuleEntry["metrics"];
}

// ─── Strategy ───

export interface CapsuleStrategy {
  name: "native_portable" | "portable_only" | "deterministic";
  supports(capabilities: ProviderCapabilities): boolean;
  generate(input: CapsuleGenerationInput, signal: AbortSignal): Promise<ContextCapsuleDraft>;
}
