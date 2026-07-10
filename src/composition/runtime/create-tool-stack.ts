import type { RuntimeToolDelegation } from "../../application/tool-delegation";
import {
  createDelegatedBashTool,
  createDelegatedInspectFileTool,
  createDelegatedLsTool,
  createDelegatedReadTool,
  createDelegatedSearchFilesTool,
  createDelegatedWriteTool,
} from "../../infrastructure/tools/delegation";
import { bashTool } from "../../infrastructure/tools/local/bash";
import { checkpointTool } from "../../infrastructure/tools/local/checkpoint";
import { editTool } from "../../infrastructure/tools/local/edit";
import { inspectFileTool } from "../../infrastructure/tools/local/inspect-file";
import { lsTool } from "../../infrastructure/tools/local/ls";
import { createMemoryTools } from "../../infrastructure/tools/local/memory-tools";
import { readTool } from "../../infrastructure/tools/local/read";
import { searchFilesTool } from "../../infrastructure/tools/local/search-files";
import { writeTool } from "../../infrastructure/tools/local/write";
import { askUserTool } from "../../kernel/tools/ask-user";
import { ToolRegistry } from "../../kernel/tools/tool-registry";

export function createToolStack(delegation?: RuntimeToolDelegation): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(delegation ? createDelegatedReadTool(delegation) : readTool);
  registry.register(delegation ? createDelegatedWriteTool(delegation) : writeTool);
  registry.register(delegation ? createDelegatedBashTool(delegation) : bashTool);
  registry.register(editTool);
  registry.register(delegation ? createDelegatedLsTool(delegation) : lsTool);
  registry.register(delegation ? createDelegatedSearchFilesTool(delegation) : searchFilesTool);
  registry.register(delegation ? createDelegatedInspectFileTool(delegation) : inspectFileTool);
  registry.register(checkpointTool);
  registry.register(askUserTool);
  for (const memoryTool of createMemoryTools()) {
    registry.register(memoryTool);
  }
  return registry;
}
