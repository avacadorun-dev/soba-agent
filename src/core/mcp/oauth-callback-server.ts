export type McpOAuthCallbackResult =
  | { type: "success"; code: string; state: string }
  | { type: "denied"; error: string; state: string | null }
  | { type: "invalid_state"; state: string | null }
  | { type: "timeout" };

export interface McpOAuthCallbackServerOptions {
  expectedState: string;
  timeoutMs: number;
  path?: string;
}

export interface McpOAuthCallbackServer {
  readonly redirectUri: string;
  readonly closed: boolean;
  waitForCallback(): Promise<McpOAuthCallbackResult>;
  close(): void;
}

const DEFAULT_CALLBACK_PATH = "/oauth/callback";

export async function startMcpOAuthCallbackServer(
  options: McpOAuthCallbackServerOptions,
): Promise<McpOAuthCallbackServer> {
  const path = normalizeCallbackPath(options.path ?? DEFAULT_CALLBACK_PATH);
  let closed = false;
  let settled = false;
  let resolveCallback: (result: McpOAuthCallbackResult) => void = () => {};
  const callbackResult = new Promise<McpOAuthCallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  const timeout = setTimeout(() => {
    settle({ type: "timeout" });
  }, options.timeoutMs);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== path) {
        return new Response("Not found", { status: 404 });
      }

      const state = url.searchParams.get("state");
      if (state !== options.expectedState) {
        settle({ type: "invalid_state", state }, { deferClose: true });
        return htmlResponse("OAuth state mismatch. Return to SOBA and try again.", 400);
      }

      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        settle({ type: "denied", error: oauthError, state }, { deferClose: true });
        return htmlResponse("OAuth request was denied. You can close this tab.", 400);
      }

      const code = url.searchParams.get("code");
      if (!code) {
        settle({ type: "denied", error: "missing_code", state }, { deferClose: true });
        return htmlResponse("OAuth callback is missing an authorization code.", 400);
      }

      settle({ type: "success", code, state }, { deferClose: true });
      return htmlResponse("OAuth login received. You can close this tab.", 200);
    },
  });

  function settle(result: McpOAuthCallbackResult, settleOptions: { deferClose?: boolean } = {}): void {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeout);
    if (settleOptions.deferClose) {
      setTimeout(() => {
        close();
        resolveCallback(result);
      }, 0);
      return;
    }

    close();
    resolveCallback(result);
  }

  function close(): void {
    if (closed) {
      return;
    }

    closed = true;
    server.stop(true);
  }

  return {
    redirectUri: `http://127.0.0.1:${server.port}${path}`,
    get closed() {
      return closed;
    },
    waitForCallback() {
      return callbackResult;
    },
    close,
  };
}

function normalizeCallbackPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function htmlResponse(message: string, status: number): Response {
  return new Response(`<!doctype html><title>SOBA OAuth</title><p>${message}</p>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
