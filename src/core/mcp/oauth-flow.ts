import { Buffer } from "node:buffer";
import {
  type McpOAuthCallbackResult,
  type McpOAuthCallbackServer,
  startMcpOAuthCallbackServer,
} from "./oauth-callback-server";
import type { McpOAuthDiscoveryPlan, McpOAuthFetch } from "./oauth-discovery";
import { createMcpPkcePair, type McpPkcePair, PKCE_CODE_CHALLENGE_METHOD } from "./oauth-pkce";

export type McpOAuthBrowserOpen = (authorizationUrl: string) => Promise<void> | void;
export type McpOAuthUserMessage = (message: string) => void;

export interface McpOAuthFlowOptions {
  plan: McpOAuthDiscoveryPlan;
  clientId: string;
  timeoutMs?: number;
  redirectPath?: string;
  fetchImpl?: McpOAuthFetch;
  openBrowser?: McpOAuthBrowserOpen;
  onUserMessage?: McpOAuthUserMessage;
  state?: string;
  pkce?: McpPkcePair;
  callbackServerFactory?: (options: {
    expectedState: string;
    timeoutMs: number;
    path: string;
  }) => Promise<McpOAuthCallbackServer>;
}

export interface McpOAuthAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
  pkce: McpPkcePair;
}

export interface McpOAuthTokenSet {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export type McpOAuthFlowResult =
  | {
      type: "success";
      tokens: McpOAuthTokenSet;
      authorizationUrl: string;
      browserOpened: boolean;
      fallbackMessage?: string;
    }
  | {
      type: "auth_denied";
      error: string;
      authorizationUrl: string;
      browserOpened: boolean;
      fallbackMessage?: string;
    }
  | {
      type: "invalid_state" | "timeout" | "token_exchange_failed";
      authorizationUrl: string;
      browserOpened: boolean;
      fallbackMessage?: string;
    };

export class McpOAuthFlowError extends Error {
  readonly code: "token_exchange_failed";

  constructor(message: string) {
    super(message);
    this.name = "McpOAuthFlowError";
    this.code = "token_exchange_failed";
  }
}

const DEFAULT_OAUTH_TIMEOUT_MS = 120_000;
const DEFAULT_REDIRECT_PATH = "/oauth/callback";

export async function runMcpOAuthLoginFlow(options: McpOAuthFlowOptions): Promise<McpOAuthFlowResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS;
  const redirectPath = options.redirectPath ?? DEFAULT_REDIRECT_PATH;
  const state = options.state ?? createOpaqueValue();
  const pkce = options.pkce ?? (await createMcpPkcePair());
  const callbackServer = await (options.callbackServerFactory ?? startMcpOAuthCallbackServer)({
    expectedState: state,
    timeoutMs,
    path: redirectPath,
  });
  const authorizationRequest = buildMcpOAuthAuthorizationRequest({
    plan: options.plan,
    clientId: options.clientId,
    redirectUri: callbackServer.redirectUri,
    state,
    pkce,
  });

  let browserOpened = false;
  let fallbackMessage: string | undefined;

  try {
    if (options.openBrowser) {
      await options.openBrowser(authorizationRequest.authorizationUrl);
      browserOpened = true;
    }
  } catch {
    fallbackMessage = `Open this MCP login URL: ${authorizationRequest.authorizationUrl}`;
    options.onUserMessage?.(fallbackMessage);
  }

  if (!options.openBrowser) {
    fallbackMessage = `Open this MCP login URL: ${authorizationRequest.authorizationUrl}`;
    options.onUserMessage?.(fallbackMessage);
  }

  const callback = await callbackServer.waitForCallback();
  const baseResult = {
    authorizationUrl: authorizationRequest.authorizationUrl,
    browserOpened,
    fallbackMessage,
  };

  if (callback.type === "timeout") {
    callbackServer.close();
    return { type: "timeout", ...baseResult };
  }

  if (callback.type === "invalid_state") {
    callbackServer.close();
    return { type: "invalid_state", ...baseResult };
  }

  if (callback.type === "denied") {
    callbackServer.close();
    return { type: "auth_denied", error: callback.error, ...baseResult };
  }

  try {
    return {
      type: "success",
      tokens: await exchangeMcpOAuthCode({
        plan: options.plan,
        clientId: options.clientId,
        redirectUri: authorizationRequest.redirectUri,
        code: callback.code,
        codeVerifier: pkce.verifier,
        fetchImpl: options.fetchImpl ?? fetch,
      }),
      ...baseResult,
    };
  } catch {
    return { type: "token_exchange_failed", ...baseResult };
  } finally {
    callbackServer.close();
  }
}

export function buildMcpOAuthAuthorizationRequest(options: {
  plan: McpOAuthDiscoveryPlan;
  clientId: string;
  redirectUri: string;
  state: string;
  pkce: McpPkcePair;
}): McpOAuthAuthorizationRequest {
  const authorizationUrl = new URL(options.plan.authorizationEndpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", options.clientId);
  authorizationUrl.searchParams.set("redirect_uri", options.redirectUri);
  authorizationUrl.searchParams.set("state", options.state);
  authorizationUrl.searchParams.set("code_challenge", options.pkce.challenge);
  authorizationUrl.searchParams.set("code_challenge_method", PKCE_CODE_CHALLENGE_METHOD);

  if (options.plan.scopes.length > 0) {
    authorizationUrl.searchParams.set("scope", options.plan.scopes.join(" "));
  }

  return {
    authorizationUrl: authorizationUrl.toString(),
    redirectUri: options.redirectUri,
    state: options.state,
    pkce: options.pkce,
  };
}

export async function exchangeMcpOAuthCode(options: {
  plan: McpOAuthDiscoveryPlan;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: McpOAuthFetch;
}): Promise<McpOAuthTokenSet> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", options.clientId);
  body.set("redirect_uri", options.redirectUri);
  body.set("code", options.code);
  body.set("code_verifier", options.codeVerifier);

  const response = await (options.fetchImpl ?? fetch)(options.plan.tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new McpOAuthFlowError("MCP OAuth token exchange failed.");
  }

  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new McpOAuthFlowError("MCP OAuth token response is invalid.");
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
  const tokenType = typeof payload.token_type === "string" ? payload.token_type : "Bearer";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : undefined;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
  const scope = typeof payload.scope === "string" ? payload.scope : undefined;

  if (!accessToken) {
    throw new McpOAuthFlowError("MCP OAuth token response is invalid.");
  }

  return {
    accessToken,
    tokenType,
    refreshToken,
    expiresIn,
    scope,
  };
}

export function redactMcpOAuthValue(value: string): string {
  return value.length === 0 ? "" : "[REDACTED]";
}

export function summarizeMcpOAuthCallback(result: McpOAuthCallbackResult): string {
  if (result.type === "success") {
    return "OAuth callback received.";
  }

  if (result.type === "denied") {
    return `OAuth denied: ${result.error}`;
  }

  if (result.type === "invalid_state") {
    return "OAuth callback state mismatch.";
  }

  return "OAuth callback timed out.";
}

function createOpaqueValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
