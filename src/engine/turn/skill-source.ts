import type { ActivatedSkillRef } from "../../kernel/transcript/types-v2";

export interface SkillPromptCatalogEntry {
  name: string;
  description: string;
  location: string;
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
}
