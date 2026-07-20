import type { ItemParam } from "../transcript/types";
import type {
  ActivatedSkillRef,
  ArtifactLedger,
  ContextCapsuleEntry,
  PortableContextState,
} from "../transcript/types-v2";

/** Serialize the portable state exactly as it is presented to the model. */
export function serializePortableState(state: PortableContextState): string {
  const lines: string[] = [];

  lines.push(`## Goal\n${state.goal}`);

  if (state.constraints.length > 0) {
    lines.push(`## Constraints\n${state.constraints.map((item) => `- ${item}`).join("\n")}`);
  }
  if (state.completed.length > 0) {
    lines.push(`## Completed\n${state.completed.map((item) => `- ${item}`).join("\n")}`);
  }
  if (state.inProgress.length > 0) {
    lines.push(`## In Progress\n${state.inProgress.map((item) => `- ${item}`).join("\n")}`);
  }
  if (state.pending.length > 0) {
    lines.push(`## Pending\n${state.pending.map((item) => `- ${item}`).join("\n")}`);
  }
  if (state.decisions.length > 0) {
    const decisions = state.decisions.map((item) =>
      item.rationale ? `- ${item.decision} (rationale: ${item.rationale})` : `- ${item.decision}`,
    );
    lines.push(`## Decisions\n${decisions.join("\n")}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`## Blockers\n${state.blockers.map((item) => `- ${item}`).join("\n")}`);
  }
  if (state.nextSteps.length > 0) {
    lines.push(`## Next Steps\n${state.nextSteps.map((item) => `- ${item}`).join("\n")}`);
  }

  return lines.join("\n\n");
}

/** Serialize all portable checkpoint data required to continue work safely. */
export function serializeCapsuleContext(
  state: PortableContextState,
  artifacts: ArtifactLedger,
  activatedSkills: ActivatedSkillRef[],
): string {
  const sections = [serializePortableState(state)];
  const artifactLines = [
    `- Verification status: ${artifacts.verificationStatus}`,
    ...artifacts.modifiedFiles.map((path) => `- Modified: ${path}`),
    ...artifacts.readFiles.map((path) => `- Read: ${path}`),
    ...artifacts.verificationCommands.map((command) => `- Verification command: ${command}`),
    ...(artifacts.checkpointSummaries ?? []).map((summary) => `- Checkpoint: ${summary}`),
  ];
  sections.push(`## Artifacts\n${artifactLines.join("\n")}`);

  if (activatedSkills.length > 0) {
    const skills = activatedSkills.map(
      (skill) => `- ${skill.name} (${skill.scope}, revision ${skill.revision}, hash ${skill.contentHash})`,
    );
    sections.push(`## Active Skills\n${skills.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Build the exact capsule prefix used by SessionManager.buildInput().
 * Context measurement shares this helper so the preflight barrier measures
 * the same input that is sent to the provider.
 */
export function buildContextCapsuleInput(
  capsule: ContextCapsuleEntry,
  providerCompatibilityKey?: string,
): ItemParam[] {
  const native = capsule.nativeContinuation;
  if (
    native !== undefined &&
    providerCompatibilityKey !== undefined &&
    providerCompatibilityKey !== "" &&
    native.compatibilityKey === providerCompatibilityKey
  ) {
    return [...(native.items as ItemParam[])];
  }

  return [{
    type: "message",
    role: "system",
    content: [{
      type: "input_text",
      text: `SOBA Context Capsule\n\n${serializeCapsuleContext(
        capsule.portableState,
        capsule.artifacts,
        capsule.activatedSkills,
      )}`,
    }],
  }];
}
