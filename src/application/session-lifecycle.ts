import type { SessionPort } from "../kernel/session/session-port";
import type { FlightRecordEntry } from "../kernel/transcript/types";
import type { ActivatedSkillRef, ContextCapsuleEntry } from "../kernel/transcript/types-v2";
import type {
  CreateSessionInput,
  ListSessionsInput,
  LoadSessionInput,
  OpenSessionInput,
  ResumeSessionInput,
  RuntimeSessionInfo,
  RuntimeSessionSnapshot,
} from "./types";

export interface RuntimeSessionHandle extends SessionPort {
  getSessionFile(): string | undefined;
  getFlightRecords(): FlightRecordEntry[];
  getCapsuleEntries(): ContextCapsuleEntry[];
  isV2(): boolean;
  branch(entryId: string): void;
  appendSkillActivation(entry: { action: "activate" | "deactivate"; skill: ActivatedSkillRef }): string;
}

export interface SessionLifecycleService {
  createSession(input: CreateSessionInput): RuntimeSessionInfo;
  openSession(input: OpenSessionInput): RuntimeSessionInfo;
  loadSession(input: LoadSessionInput): RuntimeSessionSnapshot;
  resumeSession(input: ResumeSessionInput): RuntimeSessionInfo;
  createSessionManager(input: CreateSessionInput): RuntimeSessionHandle;
  openSessionManager(input: OpenSessionInput): RuntimeSessionHandle;
  loadSessionManager(input: LoadSessionInput): RuntimeSessionHandle;
  resumeSessionManager(input: ResumeSessionInput): RuntimeSessionHandle;
  listSessions(input: ListSessionsInput): RuntimeSessionInfo[];
  closeSession(sessionId: string): void;
  deleteSession(sessionId: string): void;
}
