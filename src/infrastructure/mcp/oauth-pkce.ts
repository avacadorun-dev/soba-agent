import { Buffer } from "node:buffer";

export const PKCE_CODE_CHALLENGE_METHOD = "S256";

export interface McpPkcePair {
  verifier: string;
  challenge: string;
  method: typeof PKCE_CODE_CHALLENGE_METHOD;
}

export async function createMcpPkcePair(randomBytes?: Uint8Array): Promise<McpPkcePair> {
  const verifier = createPkceVerifier(randomBytes);
  const challenge = await createPkceChallenge(verifier);

  return {
    verifier,
    challenge,
    method: PKCE_CODE_CHALLENGE_METHOD,
  };
}

export function createPkceVerifier(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? createRandomBytes(32);
  return base64UrlEncode(bytes);
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function createRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
