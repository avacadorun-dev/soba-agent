import { unlinkSync } from "node:fs";
import {
  findSessionsById,
  getDefaultSessionDir,
  listSessions,
  SessionManager,
} from "../core/session/session-manager";
import type {
  CreateSessionInput,
  ListSessionsInput,
  LoadSessionInput,
  OpenSessionInput,
  ResumeSessionInput,
  RuntimeSessionInfo,
  RuntimeSessionSnapshot,
} from "./types";
import { sessionInfoToRuntime } from "./types";

export class SessionLifecycleService {
  private readonly projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  createSession(input: CreateSessionInput): RuntimeSessionInfo {
    return this.toRuntimeInfo(this.createSessionManager(input));
  }

  openSession(input: OpenSessionInput): RuntimeSessionInfo {
    return this.toRuntimeInfo(this.openSessionManager(input));
  }

  loadSession(input: LoadSessionInput): RuntimeSessionSnapshot {
    const session = this.loadSessionManager(input);
    return {
      info: this.toRuntimeInfo(session),
      entries: session.getEntries(),
    };
  }

  resumeSession(input: ResumeSessionInput): RuntimeSessionInfo {
    const session = this.resumeSessionManager(input);
    return this.toRuntimeInfo(session);
  }

  createSessionManager(input: CreateSessionInput): SessionManager {
    return SessionManager.create(input.cwd);
  }

  openSessionManager(input: OpenSessionInput): SessionManager {
    return SessionManager.openById(input.cwd, input.sessionId);
  }

  loadSessionManager(input: LoadSessionInput): SessionManager {
    return this.openByIdAcrossProjects(input.sessionId);
  }

  resumeSessionManager(input: ResumeSessionInput): SessionManager {
    return this.openByIdAcrossProjects(input.sessionId);
  }

  listSessions(input: ListSessionsInput): RuntimeSessionInfo[] {
    return listSessions(getDefaultSessionDir(input.cwd)).map(sessionInfoToRuntime);
  }

  closeSession(_sessionId: string): void {
    // Current SessionManager has no external resource handle to close.
  }

  deleteSession(sessionId: string): void {
    const session = this.openByIdAcrossProjects(sessionId);
    const filePath = session.getSessionFile();
    if (!filePath) return;
    unlinkSync(filePath);
  }

  private openByIdAcrossProjects(sessionId: string): SessionManager {
    const sessionDir = getDefaultSessionDir(this.projectRoot);
    const currentMatches = findSessionsById(sessionDir, sessionId);
    if (currentMatches.length === 1) return SessionManager.open(currentMatches[0]);
    if (currentMatches.length > 1) {
      throw new Error(`Multiple sessions match id prefix: ${sessionId}`);
    }

    throw new Error(`Session not found: ${sessionId} in ${sessionDir}`);
  }

  private toRuntimeInfo(session: SessionManager): RuntimeSessionInfo {
    return {
      id: session.getSessionId(),
      cwd: session.getCwd(),
    };
  }
}
