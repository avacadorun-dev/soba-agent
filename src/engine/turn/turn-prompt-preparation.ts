import type { OpenResponsesClientConfig } from "../../kernel/model/model-gateway";
import {
  filterToolsForWorkMode,
  systemGuidelinesForWorkMode,
  type WorkMode,
} from "../../kernel/work-mode/public";
import { buildProjectMemorySection, type ProjectMemorySource } from "../memory/memory-injector";
import { buildSystemPrompt } from "../prompt/system-prompt";
import type { SkillSource } from "./skill-source";
import { filterToolsForSkillPolicy } from "./work-mode-tools";

export interface ProjectContextReader {
  read(cwd: string): Array<{ path: string; content: string }> | Promise<Array<{ path: string; content: string }>>;
}

export interface PreparedTurnPrompt {
  contextFiles: Array<{ path: string; content: string }>;
  projectInstructions: string[];
  systemPrompt: string;
  model: string;
  maxOutputTokens: number;
  maxCompletionTokens: number;
  contextWindow: number;
  temperature: number;
}

export async function prepareTurnPrompt(input: {
  cwd: string;
  userText: string;
  selectedTools: string[];
  workMode?: WorkMode;
  clarificationAvailable?: boolean;
  contextReader?: ProjectContextReader;
  skillManager?: SkillSource;
  projectMemory?: ProjectMemorySource;
  modelConfig: OpenResponsesClientConfig;
}): Promise<PreparedTurnPrompt> {
  const workMode = input.workMode ?? "agent";
  const selectedTools = filterToolsForSkillPolicy(
    filterToolsForWorkMode(input.selectedTools, workMode, {
      clarificationAvailable: input.clarificationAvailable,
    }),
    input.skillManager,
  );
  const contextFiles = (await input.contextReader?.read(input.cwd)) ?? [];
  const projectInstructions = contextFiles.map((file) => file.content);
  const skills = input.skillManager?.getCatalogForPrompt() ?? [];
  const memoryAccess = input.skillManager?.getMemoryAccess?.() ?? { read: true, write: true };
  const projectMemorySection = input.projectMemory && memoryAccess.read
    ? buildProjectMemorySection(input.projectMemory, {
        maxTokens: 2_000,
        query: input.userText,
      })
    : "";
  const systemPrompt = buildSystemPrompt({
    cwd: input.cwd,
    selectedTools,
    extraGuidelines: systemGuidelinesForWorkMode(workMode),
    contextFiles,
    skills,
    projectMemorySection,
  });

  return {
    contextFiles,
    projectInstructions,
    systemPrompt,
    model: input.modelConfig.model,
    maxOutputTokens: input.modelConfig.maxOutputTokens,
    maxCompletionTokens: input.modelConfig.maxCompletionTokens ?? 0,
    contextWindow: input.modelConfig.contextWindow,
    temperature: input.modelConfig.temperature,
  };
}
