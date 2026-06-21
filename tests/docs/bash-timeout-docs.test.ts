import { describe, expect, test } from "bun:test";

describe("bash timeout documentation", () => {
  test("configuration guide documents config, env, CLI flag and default", async () => {
    const content = await Bun.file("docs-site/content/docs/configuration.ru.mdx").text();

    expect(content).toContain('"bashMaxTimeoutSeconds": 300');
    expect(content).toContain("| `bashMaxTimeoutSeconds` | `number` | `300` |");
    expect(content).toContain("`SOBA_BASH_MAX_TIMEOUT_SECONDS`");
    expect(content).toContain("`--bash-max-timeout-seconds <n>`");
  });

  test("CLI reference lists the bash max timeout flag", async () => {
    const content = await Bun.file("docs-site/content/docs/cli-reference.ru.mdx").text();

    expect(content).toContain("`--bash-max-timeout-seconds <n>`");
    expect(content).toContain("по умолчанию 300");
  });
});
