import type { SkillManager } from "../skills/skill-manager";

export type ProjectTrustCommandView =
  | { kind: "not_configured" }
  | { kind: "usage" }
  | { kind: "unknown"; subcommand: string }
  | {
      kind: "status";
      canonicalRoot: string;
      gitCommonDir?: string;
      trusted: boolean;
      trustedAt?: string;
      skillsFingerprint?: string;
    }
  | { kind: "approved"; updated: boolean }
  | { kind: "revoked"; revoked: true }
  | { kind: "revoked"; revoked: false };

export function executeProjectTrustCommand(input: {
  args: string[];
  skillManager?: SkillManager;
  projectPath: string;
}): ProjectTrustCommandView {
  const { args, skillManager, projectPath } = input;
  if (!skillManager) {
    return { kind: "not_configured" };
  }

  const subcommand = args[0]?.toLowerCase();
  if (!subcommand) {
    return { kind: "usage" };
  }

  const trustStore = skillManager.trustStore;
  const projectIdentity = trustStore.computeProjectIdentity(projectPath);

  switch (subcommand) {
    case "status": {
      const record = trustStore.getRecord(projectIdentity);
      return {
        kind: "status",
        canonicalRoot: projectIdentity.canonicalRoot,
        gitCommonDir: projectIdentity.gitCommonDir,
        trusted: trustStore.isTrusted(projectIdentity),
        trustedAt: record?.trustedAt,
        skillsFingerprint: record?.skillsFingerprint,
      };
    }

    case "approve": {
      const fingerprint = skillManager.discovery.computeFingerprint(projectIdentity.canonicalRoot);
      const isTrusted = trustStore.isTrusted(projectIdentity);

      if (isTrusted) {
        trustStore.updateFingerprint(projectIdentity, fingerprint);
      } else {
        trustStore.approve(projectIdentity, fingerprint);
      }

      skillManager.refresh();
      return { kind: "approved", updated: isTrusted };
    }

    case "revoke": {
      const revoked = trustStore.revoke(projectIdentity);
      if (revoked) {
        skillManager.refresh();
      }
      return { kind: "revoked", revoked };
    }

    default:
      return { kind: "unknown", subcommand };
  }
}
