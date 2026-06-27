import type { JsonRpcId } from "./json-rpc";

interface PendingRequest {
  id: JsonRpcId;
  method: string;
  sessionId?: string;
  controller: AbortController;
}

export class AcpRequestRegistry {
  private readonly pending = new Map<string, PendingRequest>();

  begin(id: JsonRpcId, method: string, sessionId?: string): AbortSignal {
    const key = keyForId(id);
    const existing = this.pending.get(key);
    if (existing) existing.controller.abort();

    const controller = new AbortController();
    this.pending.set(key, {
      id,
      method,
      sessionId,
      controller,
    });
    return controller.signal;
  }

  end(id: JsonRpcId): void {
    this.pending.delete(keyForId(id));
  }

  cancelById(id: JsonRpcId): boolean {
    const request = this.pending.get(keyForId(id));
    if (!request) return false;
    request.controller.abort();
    this.pending.delete(keyForId(id));
    return true;
  }

  cancelBySession(sessionId: string): number {
    let cancelled = 0;
    for (const [key, request] of this.pending) {
      if (request.sessionId !== sessionId) continue;
      request.controller.abort();
      this.pending.delete(key);
      cancelled++;
    }
    return cancelled;
  }

  listPending(): Array<{ id: JsonRpcId; method: string; sessionId?: string }> {
    return [...this.pending.values()].map(({ id, method, sessionId }) => ({
      id,
      method,
      sessionId,
    }));
  }
}

function keyForId(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}
