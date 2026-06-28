import { describe, expect, test } from "bun:test";
import { createMemoryTools } from "../../src/engine/memory/memory-tools";
import { bashTool } from "../../src/infrastructure/tools/local/bash";
import { checkpointTool } from "../../src/infrastructure/tools/local/checkpoint";
import { inspectFileTool } from "../../src/infrastructure/tools/local/inspect-file";
import { lsTool } from "../../src/infrastructure/tools/local/ls";
import { readTool } from "../../src/infrastructure/tools/local/read";
import { searchFilesTool } from "../../src/infrastructure/tools/local/search-files";
import { writeTool } from "../../src/infrastructure/tools/local/write";

describe("tool choice descriptions", () => {
  test("basic file tools describe distinct jobs", () => {
    expect(lsTool.description).toContain("path discovery and directory shape");
    expect(lsTool.description).toContain("Not a content search tool");

    expect(searchFilesTool.description).toContain("Search file contents");
    expect(searchFilesTool.description).toContain("Not a directory listing tool");

    expect(inspectFileTool.description).toContain("line-numbered range");
    expect(readTool.description).toContain("Prefer inspect_file");
  });

  test("mutation and shell tools discourage overly broad use", () => {
    expect(writeTool.description).toContain("Prefer edit for localized changes");
    expect(bashTool.description).toContain("Do not use bash for pwd, routine directory listing");
    expect(bashTool.description).toContain("routine file inspection through bash is rejected");
    expect(bashTool.description).toContain("verification workflows");
    expect(bashTool.description).toContain("--help/--version/which probes");
    expect(bashTool.description).toContain("head/tail are diagnostic only");
    expect(bashTool.description).toContain("filtered verification commands are rejected");
  });

  test("long-task and memory tools are scoped", () => {
    const memoryTools = createMemoryTools();
    const readMemoryTool = memoryTools.find((tool) => tool.name === "read_project_memory");
    const writeMemoryTool = memoryTools.find((tool) => tool.name === "write_project_memory");

    expect(checkpointTool.description).toContain("meaningful milestone or plan pivot");
    expect(checkpointTool.description).toContain("should not be used for routine progress logging");
    expect(readMemoryTool?.description).toContain("not general project files");
    expect(writeMemoryTool?.description).toContain("Never use write/edit/bash");
  });
});
