import type {
  CompactFallbackCompactorPort,
  CompactFallbackInput,
  CompactFallbackOutcome,
} from "../../application/commands/compact";
import { compact } from "../../engine/compaction/compaction";

export class EngineCompactFallbackCompactor implements CompactFallbackCompactorPort {
  async compact(input: CompactFallbackInput): Promise<CompactFallbackOutcome> {
    return compact(input.session, input.client, {
      instructions: input.instructions,
      keepRecentTokens: input.keepRecentTokens,
    });
  }
}
