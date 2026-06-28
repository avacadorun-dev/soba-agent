export interface DelegatedReadTextFileInput {
  cwd: string;
  sessionId?: string;
  path: string;
  signal?: AbortSignal;
}

export interface DelegatedWriteTextFileInput {
  cwd: string;
  sessionId?: string;
  path: string;
  content: string;
  signal?: AbortSignal;
}

export interface DelegatedTerminalInput {
  cwd: string;
  sessionId?: string;
  command: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface DelegatedListDirectoryInput {
  cwd: string;
  sessionId?: string;
  path?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface DelegatedInspectTextFileInput {
  cwd: string;
  sessionId?: string;
  path: string;
  startLine?: number;
  endLine?: number;
  aroundLine?: number;
  contextLines?: number;
  maxLines?: number;
  signal?: AbortSignal;
}

export interface DelegatedSearchFilesInput {
  cwd: string;
  sessionId?: string;
  query: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
  signal?: AbortSignal;
}

export interface DelegatedTerminalResult {
  stdout?: string;
  stderr?: string;
  output?: string;
  exitCode?: number | null;
  signalCode?: string | null;
  timedOut?: boolean;
  terminalId?: string;
}

export interface RuntimeToolDelegation {
  readTextFile?(input: DelegatedReadTextFileInput): Promise<string | { text: string } | undefined>;
  writeTextFile?(input: DelegatedWriteTextFileInput): Promise<{ bytes?: number; lines?: number } | undefined>;
  runTerminal?(input: DelegatedTerminalInput): Promise<DelegatedTerminalResult | undefined>;
  listDirectory?(input: DelegatedListDirectoryInput): Promise<string | { text?: string; entries?: string[]; entryCount?: number; truncated?: boolean } | undefined>;
  inspectTextFile?(input: DelegatedInspectTextFileInput): Promise<string | { text: string; totalLines?: number; startLine?: number; endLine?: number; truncated?: boolean } | undefined>;
  searchFiles?(input: DelegatedSearchFilesInput): Promise<string | { text: string; matchCount?: number; truncated?: boolean } | undefined>;
}
