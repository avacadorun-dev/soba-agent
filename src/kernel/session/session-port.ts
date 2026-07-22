import type {
  CompactionSummaryItemParam,
  DebugEntry,
  FlightRecordData,
  ItemParam,
  SessionEntry,
  SessionInput,
} from "../transcript/types";
import type { ActivatedSkillRef, ContextCapsuleEntry } from "../transcript/types-v2";

export interface SessionPort {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  isPersisted(): boolean;
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
  getEntries(): SessionEntry[];
  buildInput(providerCompatibilityKey?: string): SessionInput;
  appendItem(item: ItemParam): string;
  appendDebug(data: DebugEntry["data"]): void;
  appendFlightRecord(data: FlightRecordData): void;
  appendSessionConfig(key: string, value: unknown): void;
  getSessionConfig(key: string): unknown;
  appendCompaction(
    strategy: string,
    item: CompactionSummaryItemParam,
    firstKeptEntryId: string | null,
    tokensBefore: number,
  ): string;
  getActiveSkillRefs(): ActivatedSkillRef[];
  generateCheckpointId(): string;
  appendContextCapsule(entry: Omit<ContextCapsuleEntry, "id" | "parentId" | "timestamp" | "type">): string;
}
