export type McpOAuthDiscoveryErrorCode =
  | "invalid_challenge"
  | "invalid_metadata_url"
  | "metadata_fetch_failed"
  | "invalid_protected_resource_metadata"
  | "invalid_authorization_server_metadata"
  | "authorization_server_not_found";

export type McpOAuthDiscoveryNextAction =
  | "retry_request"
  | "fix_server_metadata"
  | "use_https_metadata"
  | "configure_oauth_scopes"
  | "try_login_again";

export type McpOAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface McpOAuthDiscoveryOptions {
  serverId: string;
  resourceUrl: string;
  wwwAuthenticate?: string | null;
  defaultScopes?: string[];
  fetchImpl?: McpOAuthFetch;
}

export interface McpBearerChallenge {
  resourceMetadataUrl?: string;
  scope?: string;
}

export interface McpOAuthProtectedResourceMetadata {
  resource: string;
  authorizationServers: string[];
  raw: Record<string, unknown>;
}

export interface McpOAuthAuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  raw: Record<string, unknown>;
}

export interface McpOAuthDiscoveryPlan {
  serverId: string;
  resourceUrl: string;
  resourceMetadataUrl: string;
  protectedResource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  scopes: string[];
}

const PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER_WELL_KNOWN = "/.well-known/oauth-authorization-server";
const OIDC_WELL_KNOWN = "/.well-known/openid-configuration";

export class McpOAuthDiscoveryError extends Error {
  readonly code: McpOAuthDiscoveryErrorCode;
  readonly nextAction: McpOAuthDiscoveryNextAction;

  constructor(code: McpOAuthDiscoveryErrorCode, message: string, nextAction: McpOAuthDiscoveryNextAction) {
    super(message);
    this.name = "McpOAuthDiscoveryError";
    this.code = code;
    this.nextAction = nextAction;
  }
}

export async function discoverMcpOAuthPlan(options: McpOAuthDiscoveryOptions): Promise<McpOAuthDiscoveryPlan> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const challenge = parseBearerWwwAuthenticate(options.wwwAuthenticate ?? null);
  const resourceUrl = parseAbsoluteUrl(options.resourceUrl, "invalid_metadata_url", "MCP resource URL is invalid.");
  const protectedResourceDiscovery = challenge.resourceMetadataUrl
    ? await fetchExplicitProtectedResourceMetadata(challenge.resourceMetadataUrl, fetchImpl)
    : await discoverProtectedResourceMetadata(resourceUrl, fetchImpl);
  const authServer = await discoverAuthorizationServerMetadata(
    protectedResourceDiscovery.metadata.authorizationServers,
    fetchImpl,
  );
  const scopes = selectScopes(challenge.scope, options.defaultScopes ?? []);

  return {
    serverId: options.serverId,
    resourceUrl: resourceUrl.toString(),
    resourceMetadataUrl: protectedResourceDiscovery.url,
    protectedResource: protectedResourceDiscovery.metadata.resource,
    issuer: authServer.issuer,
    authorizationEndpoint: authServer.authorizationEndpoint,
    tokenEndpoint: authServer.tokenEndpoint,
    revocationEndpoint: authServer.revocationEndpoint,
    scopes,
  };
}

async function fetchExplicitProtectedResourceMetadata(
  metadataUrl: string,
  fetchImpl: McpOAuthFetch,
): Promise<{ url: string; metadata: McpOAuthProtectedResourceMetadata }> {
  const url = validateMetadataEndpointUrl(metadataUrl);

  return {
    url,
    metadata: await fetchProtectedResourceMetadata(url, fetchImpl),
  };
}

export function parseBearerWwwAuthenticate(header: string | null): McpBearerChallenge {
  if (!header) {
    return {};
  }

  const bearerIndex = header.toLowerCase().indexOf("bearer");
  if (bearerIndex < 0) {
    return {};
  }

  const beforeBearer = header.slice(0, bearerIndex).trim();
  if (beforeBearer.length > 0 && !beforeBearer.endsWith(",")) {
    throw new McpOAuthDiscoveryError(
      "invalid_challenge",
      "MCP OAuth challenge is malformed.",
      "try_login_again",
    );
  }

  const params = parseAuthParams(header.slice(bearerIndex + "bearer".length));
  return {
    resourceMetadataUrl: params.get("resource_metadata"),
    scope: params.get("scope"),
  };
}

function parseAuthParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  let index = 0;

  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index] ?? "")) {
      index += 1;
    }

    const keyStart = index;
    while (index < value.length && isAuthParamNameChar(value[index] ?? "")) {
      index += 1;
    }

    const key = value.slice(keyStart, index).toLowerCase();
    if (key.length === 0) {
      break;
    }

    while (index < value.length && /\s/.test(value[index] ?? "")) {
      index += 1;
    }

    if (value[index] !== "=") {
      throw new McpOAuthDiscoveryError(
        "invalid_challenge",
        "MCP OAuth challenge parameter is malformed.",
        "try_login_again",
      );
    }

    index += 1;
    while (index < value.length && /\s/.test(value[index] ?? "")) {
      index += 1;
    }

    const parsedValue = value[index] === "\"" ? readQuotedParamValue(value, index) : readTokenParamValue(value, index);
    params.set(key, parsedValue.value);
    index = parsedValue.nextIndex;
  }

  return params;
}

function readQuotedParamValue(value: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  let result = "";

  while (index < value.length) {
    const char = value[index] ?? "";
    if (char === "\"") {
      return { value: result, nextIndex: index + 1 };
    }

    if (char === "\\") {
      index += 1;
      result += value[index] ?? "";
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  throw new McpOAuthDiscoveryError("invalid_challenge", "MCP OAuth challenge quote is unterminated.", "try_login_again");
}

function readTokenParamValue(value: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex;
  while (index < value.length && value[index] !== ",") {
    index += 1;
  }

  return { value: value.slice(startIndex, index).trim(), nextIndex: index };
}

function isAuthParamNameChar(char: string): boolean {
  return /[a-zA-Z0-9_.-]/.test(char);
}

async function discoverProtectedResourceMetadata(
  resourceUrl: URL,
  fetchImpl: McpOAuthFetch,
): Promise<{ url: string; metadata: McpOAuthProtectedResourceMetadata }> {
  const candidates = buildProtectedResourceMetadataUrls(resourceUrl);
  let sawFetchFailure = false;

  for (const candidate of candidates) {
    const response = await fetchMetadata(candidate, fetchImpl);
    if (response.status === "ok") {
      return {
        url: candidate,
        metadata: parseProtectedResourceMetadata(response.body),
      };
    }

    if (response.status === "error") {
      sawFetchFailure = true;
    }
  }

  if (sawFetchFailure) {
    throw new McpOAuthDiscoveryError(
      "metadata_fetch_failed",
      "MCP OAuth protected resource metadata could not be fetched.",
      "retry_request",
    );
  }

  throw new McpOAuthDiscoveryError(
    "invalid_protected_resource_metadata",
    "MCP OAuth protected resource metadata was not found.",
    "fix_server_metadata",
  );
}

function buildProtectedResourceMetadataUrls(resourceUrl: URL): string[] {
  const rootUrl = `${resourceUrl.origin}${PROTECTED_RESOURCE_WELL_KNOWN}`;
  const candidates: string[] = [];

  if (resourceUrl.pathname !== "/") {
    candidates.push(`${resourceUrl.origin}${PROTECTED_RESOURCE_WELL_KNOWN}${resourceUrl.pathname}`);
  }

  candidates.push(rootUrl);
  return candidates;
}

async function fetchProtectedResourceMetadata(
  metadataUrl: string,
  fetchImpl: McpOAuthFetch,
): Promise<McpOAuthProtectedResourceMetadata> {
  const raw = await fetchRequiredJsonMetadata(metadataUrl, fetchImpl, "protected resource metadata");
  return parseProtectedResourceMetadata(raw);
}

function parseProtectedResourceMetadata(raw: unknown): McpOAuthProtectedResourceMetadata {
  if (!isRecord(raw)) {
    throwInvalidProtectedResourceMetadata();
  }

  const resource = typeof raw.resource === "string" ? raw.resource : undefined;
  const authorizationServers = Array.isArray(raw.authorization_servers)
    ? raw.authorization_servers.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (!resource || authorizationServers.length === 0) {
    throwInvalidProtectedResourceMetadata();
  }

  for (const authorizationServer of authorizationServers) {
    validateMetadataEndpointUrl(authorizationServer);
  }

  return {
    resource,
    authorizationServers,
    raw,
  };
}

async function discoverAuthorizationServerMetadata(
  issuers: string[],
  fetchImpl: McpOAuthFetch,
): Promise<McpOAuthAuthorizationServerMetadata> {
  for (const issuer of issuers) {
    const issuerUrl = validateMetadataEndpointUrl(issuer);
    const candidates = buildAuthorizationServerMetadataUrls(issuerUrl);

    for (const candidate of candidates) {
      const response = await fetchMetadata(candidate, fetchImpl);
      if (response.status !== "ok") {
        continue;
      }

      const metadata = parseAuthorizationServerMetadata(response.body);
      if (metadata.issuer !== issuerUrl) {
        throw new McpOAuthDiscoveryError(
          "invalid_authorization_server_metadata",
          "MCP OAuth authorization server metadata issuer does not match the discovered issuer.",
          "fix_server_metadata",
        );
      }

      return metadata;
    }
  }

  throw new McpOAuthDiscoveryError(
    "authorization_server_not_found",
    "MCP OAuth authorization server metadata was not found.",
    "fix_server_metadata",
  );
}

function buildAuthorizationServerMetadataUrls(issuer: string): string[] {
  const issuerUrl = new URL(issuer);
  const suffix = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname;

  return [
    `${issuerUrl.origin}${AUTHORIZATION_SERVER_WELL_KNOWN}${suffix}`,
    `${issuerUrl.origin}${OIDC_WELL_KNOWN}${suffix}`,
  ];
}

function parseAuthorizationServerMetadata(raw: unknown): McpOAuthAuthorizationServerMetadata {
  if (!isRecord(raw)) {
    throwInvalidAuthorizationServerMetadata();
  }

  const issuer = typeof raw.issuer === "string" ? raw.issuer : undefined;
  const authorizationEndpoint =
    typeof raw.authorization_endpoint === "string" ? raw.authorization_endpoint : undefined;
  const tokenEndpoint = typeof raw.token_endpoint === "string" ? raw.token_endpoint : undefined;
  const revocationEndpoint = typeof raw.revocation_endpoint === "string" ? raw.revocation_endpoint : undefined;

  if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
    throwInvalidAuthorizationServerMetadata();
  }

  validateMetadataEndpointUrl(issuer);
  validateMetadataEndpointUrl(authorizationEndpoint);
  validateMetadataEndpointUrl(tokenEndpoint);
  if (revocationEndpoint) {
    validateMetadataEndpointUrl(revocationEndpoint);
  }

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
    raw,
  };
}

async function fetchRequiredJsonMetadata(metadataUrl: string, fetchImpl: McpOAuthFetch, label: string): Promise<unknown> {
  const response = await fetchMetadata(metadataUrl, fetchImpl);
  if (response.status === "ok") {
    return response.body;
  }

  throw new McpOAuthDiscoveryError(
    response.status === "not_found" ? "invalid_protected_resource_metadata" : "metadata_fetch_failed",
    `MCP OAuth ${label} could not be loaded.`,
    response.status === "not_found" ? "fix_server_metadata" : "retry_request",
  );
}

async function fetchMetadata(
  metadataUrl: string,
  fetchImpl: McpOAuthFetch,
): Promise<{ status: "ok"; body: unknown } | { status: "not_found" } | { status: "error" }> {
  try {
    const response = await fetchImpl(metadataUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return { status: "not_found" };
    }

    if (!response.ok) {
      return { status: "error" };
    }

    return {
      status: "ok",
      body: await response.json(),
    };
  } catch {
    return { status: "error" };
  }
}

function selectScopes(challengeScope: string | undefined, defaultScopes: string[]): string[] {
  const selected = challengeScope ? challengeScope.split(/\s+/).filter(Boolean) : defaultScopes;
  return [...new Set(selected)];
}

function validateMetadataEndpointUrl(value: string): string {
  const url = parseAbsoluteUrl(value, "invalid_metadata_url", "MCP OAuth metadata URL is invalid.");
  if (url.protocol === "https:") {
    return url.toString();
  }

  if (url.protocol === "http:" && isLocalhost(url.hostname)) {
    return url.toString();
  }

  throw new McpOAuthDiscoveryError(
    "invalid_metadata_url",
    "MCP OAuth metadata URL must use HTTPS outside localhost development.",
    "use_https_metadata",
  );
}

function parseAbsoluteUrl(value: string, code: McpOAuthDiscoveryErrorCode, message: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new McpOAuthDiscoveryError(code, message, "fix_server_metadata");
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function throwInvalidProtectedResourceMetadata(): never {
  throw new McpOAuthDiscoveryError(
    "invalid_protected_resource_metadata",
    "MCP OAuth protected resource metadata is invalid.",
    "fix_server_metadata",
  );
}

function throwInvalidAuthorizationServerMetadata(): never {
  throw new McpOAuthDiscoveryError(
    "invalid_authorization_server_metadata",
    "MCP OAuth authorization server metadata is invalid.",
    "fix_server_metadata",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
