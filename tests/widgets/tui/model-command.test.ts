import { describe, expect, test } from "bun:test";
import { createModelCommand } from "../../../src/widgets/tui/commands/model-command";

describe("/model command", () => {
  test("opens model selector without a query", () => {
    let openCount = 0;
    const queries: string[] = [];
    const command = createModelCommand({
      providerStore: {
        open: () => {
          openCount++;
        },
        setSearch: (value) => {
          queries.push(value);
        },
      },
    });

    expect(command.handler?.([], {})).toEqual({ handled: true });
    expect(openCount).toBe(1);
    expect(queries).toEqual([]);
  });

  test("uses command args as selector search query", () => {
    let openCount = 0;
    const queries: string[] = [];
    const command = createModelCommand({
      providerStore: {
        open: () => {
          openCount++;
        },
        setSearch: (value) => {
          queries.push(value);
        },
      },
    });

    expect(command.handler?.(["deepseek", "reasoner"], {})).toEqual({ handled: true });
    expect(openCount).toBe(1);
    expect(queries).toEqual(["deepseek reasoner"]);
  });
});
