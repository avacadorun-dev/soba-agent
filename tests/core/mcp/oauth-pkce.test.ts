import { describe, expect, test } from "bun:test";
import { createMcpPkcePair, createPkceChallenge, createPkceVerifier } from "../../../src/infrastructure/mcp/oauth-pkce";

describe("MCP OAuth PKCE", () => {
  test("PKCE challenge is deterministic for fixed verifier", async () => {
    await expect(createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("generated verifier is base64url encoded and paired with S256 challenge", async () => {
    const bytes = new Uint8Array(32);
    bytes.fill(7);

    const pair = await createMcpPkcePair(bytes);

    expect(pair.method).toBe("S256");
    expect(pair.verifier).toBe(createPkceVerifier(bytes));
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.challenge).toBe(await createPkceChallenge(pair.verifier));
  });
});
