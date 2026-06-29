export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export class SseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private dataLines: string[] = [];
  private eventType: string | undefined;
  private eventId: string | undefined;
  private retryMs: number | undefined;

  push(chunk: string | Uint8Array): SseEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.drainLines(false);
  }

  flush(): SseEvent[] {
    this.buffer += this.decoder.decode();
    return this.drainLines(true);
  }

  private drainLines(flush: boolean): SseEvent[] {
    const events: SseEvent[] = [];

    while (true) {
      const lineEnd = findLineEnd(this.buffer);
      if (!lineEnd) {
        break;
      }

      const line = this.buffer.slice(0, lineEnd.index);
      this.buffer = this.buffer.slice(lineEnd.nextIndex);
      const event = this.consumeLine(line);
      if (event) {
        events.push(event);
      }
    }

    if (flush && this.buffer.length > 0) {
      const event = this.consumeLine(this.buffer);
      this.buffer = "";
      if (event) {
        events.push(event);
      }
    }

    if (flush) {
      const event = this.dispatch();
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private consumeLine(line: string): SseEvent | null {
    if (line.length === 0) {
      return this.dispatch();
    }

    if (line.startsWith(":")) {
      return null;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value = colonIndex === -1 ? "" : trimSingleLeadingSpace(line.slice(colonIndex + 1));

    if (field === "data") {
      this.dataLines.push(value);
    } else if (field === "event") {
      this.eventType = value;
    } else if (field === "id") {
      this.eventId = value;
    } else if (field === "retry") {
      const retry = Number(value);
      if (Number.isInteger(retry) && retry >= 0) {
        this.retryMs = retry;
      }
    }

    return null;
  }

  private dispatch(): SseEvent | null {
    if (this.dataLines.length === 0) {
      this.eventType = undefined;
      this.retryMs = undefined;
      return null;
    }

    const event: SseEvent = {
      data: this.dataLines.join("\n"),
    };
    if (this.eventType !== undefined) {
      event.event = this.eventType;
    }
    if (this.eventId !== undefined) {
      event.id = this.eventId;
    }
    if (this.retryMs !== undefined) {
      event.retry = this.retryMs;
    }

    this.dataLines = [];
    this.eventType = undefined;
    this.retryMs = undefined;
    return event;
  }
}

function findLineEnd(value: string): { index: number; nextIndex: number } | null {
  const newlineIndex = value.indexOf("\n");
  const carriageIndex = value.indexOf("\r");

  if (newlineIndex === -1 && carriageIndex === -1) {
    return null;
  }

  if (carriageIndex !== -1 && (newlineIndex === -1 || carriageIndex < newlineIndex)) {
    const nextIndex = value[carriageIndex + 1] === "\n" ? carriageIndex + 2 : carriageIndex + 1;
    return { index: carriageIndex, nextIndex };
  }

  return { index: newlineIndex, nextIndex: newlineIndex + 1 };
}

function trimSingleLeadingSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}
