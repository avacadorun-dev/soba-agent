/**
 * CLI argument parsing — Phase 2.5 B1e.
 *
 * Maps to UC-06 in internal-design-notes
 *   UC-06: Back-compat for legacy CLI flags.
 *
 * Test cases:
 *   1. --max-tokens is accepted as an alias for --max-output-tokens
 *   2. --max-tokens emits a one-shot deprecation warning to stderr
 *   3. canonical --max-output-tokens does NOT emit a deprecation warning
 *   4. --max-tokens and --max-output-tokens: --max-output-tokens wins
 *      (last-wins semantics — matches the rest of the parser).
 */
import { describe, expect, test } from "bun:test";
import {
  _resetMaxTokensWarningForTests,
  parseArgs,
} from "../../src/cli/args";

describe("parseArgs — B1e: --max-tokens alias", () => {
  test("parses ACP stdio server subcommand", () => {
    const args = parseArgs(["acp"]);

    expect(args.acp).toBe(true);
    expect(args.prompt).toBeUndefined();
  });

  test("--max-tokens populates maxOutputTokens", () => {
    _resetMaxTokensWarningForTests();
    const args = parseArgs(["--max-tokens", "4096"]);
    expect(args.maxOutputTokens).toBe(4096);
  });

  test("--max-tokens emits a deprecation warning to stderr", () => {
    _resetMaxTokensWarningForTests();
    const origErr = console.error;
    const origWarn = console.warn;
    const errLines: string[] = [];
    const warnLines: string[] = [];
    console.error = (msg: string) => errLines.push(msg);
    console.warn = (msg: string) => warnLines.push(msg);
    try {
      parseArgs(["--max-tokens", "2048"]);
      const combined = [...errLines, ...warnLines].join("\n");
      expect(combined).toMatch(/--max-tokens/);
      expect(combined).toMatch(/deprecated|--max-output-tokens/);
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }
  });

  test("deprecation warning fires at most once per process", () => {
    _resetMaxTokensWarningForTests();
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      parseArgs(["--max-tokens", "1024"]);
      parseArgs(["--max-tokens", "2048"]);
      parseArgs(["--max-tokens", "4096"]);
      // Exactly one warning, regardless of how many times the flag is used.
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });

  test("--max-output-tokens does NOT emit a deprecation warning", () => {
    _resetMaxTokensWarningForTests();
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      parseArgs(["--max-output-tokens", "8192"]);
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = origWarn;
    }
  });

  test("--max-output-tokens takes precedence over --max-tokens when both are passed (last-wins)", () => {
    _resetMaxTokensWarningForTests();
    // Suppress the deprecation warning noise.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const args = parseArgs(["--max-tokens", "1024", "--max-output-tokens", "8192"]);
      expect(args.maxOutputTokens).toBe(8192);
    } finally {
      console.warn = origWarn;
    }
  });
});
