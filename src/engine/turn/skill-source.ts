import type { ActivatedSkillRef, SkillMemoryAccess, SkillToolPolicyDecision } from "../../kernel/transcript/types-v2";

export interface SkillPromptCatalogEntry {
  name: string;
  description: string;
  location: string;
  triggers: string[];
}

export interface SkillLookupEntry {
  name: string;
  revision?: string;
  scope: ActivatedSkillRef["scope"];
}

export interface SkillSource {
  getCatalogForPrompt(): SkillPromptCatalogEntry[];
  buildEphemeralMessages(): Array<{ role: "developer"; content: string }>;
  getSkill(name: string): SkillLookupEntry | undefined;
  getMemoryAccess?(): SkillMemoryAccess;
  evaluateToolPolicy?(toolName: string): SkillToolPolicyDecision;
  /** Activate project-declared required skills matching the user prompt; returns newly activated names. */
  activateDeclaredSkillsForPrompt?(prompt: string): string[];
}
