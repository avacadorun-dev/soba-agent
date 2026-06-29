import type { TrustManager } from "../../application/trust/trust-manager";
import type { McpClientManager } from "../../infrastructure/mcp/client-manager";
import { McpRuntimeController } from "../../infrastructure/mcp/runtime-controller";
import { McpSecretStore } from "../../infrastructure/mcp/secret-store";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";

export interface McpStackInput {
  projectRoot: string;
  homeDir: string;
  toolRegistry: ToolRegistry;
  trustManager: TrustManager;
}

export interface McpStack {
  mcpSecretStore: McpSecretStore;
  mcpRuntime: McpRuntimeController;
  mcpManager?: McpClientManager;
}

export async function createMcpStack(input: McpStackInput): Promise<McpStack> {
  const mcpSecretStore = new McpSecretStore({ homeDir: input.homeDir });
  const mcpRuntime = new McpRuntimeController({
    projectRoot: input.projectRoot,
    secretStore: mcpSecretStore,
    toolRegistry: input.toolRegistry,
    trustManager: input.trustManager,
  });
  await mcpRuntime.initialize();

  return {
    mcpSecretStore,
    mcpRuntime,
    mcpManager: mcpRuntime.getManager(),
  };
}
