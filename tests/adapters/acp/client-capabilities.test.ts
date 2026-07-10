import { describe, expect, test } from "bun:test";
import { parseAcpClientCapabilities } from "../../../src/adapters/acp/client-capabilities";

describe("ACP client capabilities", () => {
  test("recognizes opt-in unstable form elicitation", () => {
    expect(parseAcpClientCapabilities({ elicitation: { form: {} } }).elicitationForm).toBe(true);
    expect(parseAcpClientCapabilities({}).elicitationForm).toBe(false);
  });
});
