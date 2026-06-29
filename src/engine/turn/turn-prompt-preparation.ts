import type { OpenResponsesClientConfig } from "../../kernel/model/model-gateway";
import { buildProjectMemorySection, type ProjectMemorySource } from "../memory/memory-injector";
import { buildSystemPrompt } from "../prompt/system-prompt";
import type { SkillSource } from "./skill-source";

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
  contextReader?: ProjectContextReader;
  skillManager?: SkillSource;
  projectMemory?: ProjectMemorySource;
  modelConfig: OpenResponsesClientConfig;
}): Promise<PreparedTurnPrompt> {
  const contextFiles = (await input.contextReader?.read(input.cwd)) ?? [];
  const projectInstructions = contextFiles.map((file) => file.content);
  const skills = input.skillManager?.getCatalogForPrompt() ?? [];
  const projectMemorySection = input.projectMemory
    ? buildProjectMemorySection(input.projectMemory, {
        maxTokens: 2_000,
        query: input.userText,
      })
    : "";
  const systemPrompt = buildSystemPrompt({
    cwd: input.cwd,
    selectedTools: input.selectedTools,
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
