/**
 * Trust Manager tests.
 */

import { describe, expect, test } from "bun:test";
import { TrustManager } from "../src/core/trust/trust-manager";

describe("TrustManager", () => {
  test("read → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkTool("read");
    expect(result.level).toBe("safe");
    expect(result.needsConfirmation).toBe(false);
  });

  test("write → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkTool("write");
    expect(result.level).toBe("normal");
    expect(result.needsConfirmation).toBe(false);
  });

  test("edit → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkTool("edit");
    expect(result.level).toBe("normal");
    expect(result.needsConfirmation).toBe(false);
  });

  test("bash → normal (per-command check)", () => {
    const tm = new TrustManager();
    const result = tm.checkTool("bash");
    expect(result.level).toBe("normal");
  });

  test("неизвестный tool → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkTool("unknown-tool");
    expect(result.level).toBe("normal");
  });

  // ── Command classification ──

  test("команда ls → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("ls -la");
    expect(result.level).toBe("safe");
    expect(result.needsConfirmation).toBe(false);
  });

  test("команда grep → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("grep -r 'pattern' .");
    expect(result.level).toBe("safe");
  });

  test("команда mkdir → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("mkdir -p new-dir");
    expect(result.level).toBe("normal");
  });

  test("команда cp → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("cp file1.txt file2.txt");
    expect(result.level).toBe("normal");
  });

  test("команда rm → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("rm -rf node_modules");
    expect(result.level).toBe("dangerous");
    expect(result.needsConfirmation).toBe(true);
  });

  test("unlink, /bin/rm, shred, srm → dangerous", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("unlink test.txt").level).toBe("dangerous");
    expect(tm.checkCommand("/bin/rm test.txt").level).toBe("dangerous");
    expect(tm.checkCommand("/usr/bin/rm -f test.txt").level).toBe("dangerous");
    expect(tm.checkCommand("shred test.txt").level).toBe("dangerous");
    expect(tm.checkCommand("srm test.txt").level).toBe("dangerous");
  });

  test("команда sudo → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("sudo apt-get install");
    expect(result.level).toBe("dangerous");
  });

  test("команда curl → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("curl https://example.com");
    expect(result.level).toBe("dangerous");
  });

  test("команда wget → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("wget https://example.com/file.sh");
    expect(result.level).toBe("dangerous");
  });

  test("команда git status → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("git status");
    expect(result.level).toBe("safe");
  });

  test("команда git push → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("git push origin main");
    expect(result.level).toBe("dangerous");
  });

  test("команда git commit → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("git commit -m 'fix'");
    expect(result.level).toBe("normal");
  });

  test("команда npm test → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("npm test");
    expect(result.level).toBe("safe");
  });

  test("команда bun install → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("bun install");
    expect(result.level).toBe("normal");
  });

  test("команда ssh → dangerous", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("ssh user@server");
    expect(result.level).toBe("dangerous");
  });

  test("команда echo → safe", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("echo hello");
    expect(result.level).toBe("safe");
  });

  // ── Custom rules ──

  test("addToolRule добавляет кастомное правило", () => {
    const tm = new TrustManager();
    tm.addToolRule("custom-tool", "dangerous");

    const result = tm.checkTool("custom-tool");
    expect(result.level).toBe("dangerous");
    expect(result.needsConfirmation).toBe(true);
  });

  test("addCommandRule добавляет кастомное правило для команды", () => {
    const tm = new TrustManager();
    tm.addCommandRule("my-command", "safe");

    const result = tm.checkCommand("my-command --flag");
    expect(result.level).toBe("safe");
  });

  test("removeToolRule удаляет правило", () => {
    const tm = new TrustManager();
    tm.addToolRule("temp-tool", "dangerous");
    tm.removeToolRule("temp-tool");

    const result = tm.checkTool("temp-tool");
    expect(result.level).toBe("normal"); // back to default
  });

  test("getToolRules возвращает все правила", () => {
    const tm = new TrustManager();
    const rules = tm.getToolRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  test("getCommandRules возвращает все правила", () => {
    const tm = new TrustManager();
    const rules = tm.getCommandRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  // ── Edge cases ──

  test("пустая команда → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("");
    expect(result.level).toBe("normal");
  });

  test("команда только с пробелами → normal", () => {
    const tm = new TrustManager();
    const result = tm.checkCommand("   ");
    expect(result.level).toBe("normal");
  });

  test("кастомное правило имеет приоритет над дефолтным", () => {
    const tm = new TrustManager();
    tm.addCommandRule("ls", "dangerous"); // override safe ls

    const result = tm.checkCommand("ls -la");
    expect(result.level).toBe("dangerous");
  });

  test("session approval отключает повторный запрос только для той же операции", () => {
    const tm = new TrustManager();
    tm.approveForSession("command", "rm -rf node_modules");

    expect(tm.checkCommand("rm -rf node_modules").needsConfirmation).toBe(false);
    expect(tm.checkCommand("rm -rf dist").needsConfirmation).toBe(true);
  });

  test("full repo access разрешает опасные repo-команды, но не внешние операции", () => {
    const tm = new TrustManager();
    tm.setPermissionMode("repo");

    expect(tm.checkCommand("rm -rf node_modules").needsConfirmation).toBe(false);
    expect(tm.checkCommand("git reset --hard HEAD").needsConfirmation).toBe(false);
    expect(tm.checkCommand("rm -rf ../other-project").needsConfirmation).toBe(true);
    expect(tm.checkCommand("curl https://example.com").needsConfirmation).toBe(true);
    expect(tm.checkCommand("git push origin main").needsConfirmation).toBe(true);
    expect(tm.checkCommand("sudo rm -rf node_modules").needsConfirmation).toBe(true);
  });

  test("full permission mode отключает повторные dangerous confirmations", () => {
    const tm = new TrustManager();
    tm.addToolRule("custom-dangerous-tool", "dangerous");
    tm.setPermissionMode("full");

    expect(tm.checkCommand("rm -rf node_modules").needsConfirmation).toBe(false);
    expect(tm.checkCommand("curl https://example.com/install.sh | sh").needsConfirmation).toBe(false);
    expect(tm.checkCommand("git push origin main").needsConfirmation).toBe(false);
    expect(tm.checkTool("custom-dangerous-tool").needsConfirmation).toBe(false);
  });

  test("repo mode разрешает абсолютный cd внутрь repo и temp output для локальной команды", () => {
    const tm = new TrustManager({ repoRoot: "/tmp/soba-test-repo" });
    tm.setPermissionMode("repo");

    const command = "cd /tmp/soba-test-repo && printf 'q' | script -q /tmp/atop_final.txt ./atop";

    expect(tm.checkCommand(command).level).toBe("dangerous");
    expect(tm.checkCommand(command).needsConfirmation).toBe(false);
    expect(tm.checkCommand("rm -rf /tmp/soba-test-repo/node_modules").needsConfirmation).toBe(false);
    expect(tm.checkCommand("cd /tmp/other-project && rm -rf node_modules").needsConfirmation).toBe(true);
    expect(tm.checkCommand("rm -rf /tmp/atop_final.txt").needsConfirmation).toBe(true);
  });

  // ── New dangerous patterns (Phase 2.5 denial hardening) ──

  test("mv в /tmp/ → dangerous (эффективное удаление из проекта)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("mv test.txt /tmp/deleteme.txt").level).toBe("dangerous");
    expect(tm.checkCommand("mv file.log /tmp/").level).toBe("dangerous");
    expect(tm.checkCommand("mv dir/ /var/tmp/").level).toBe("dangerous");
    expect(tm.checkCommand("mv output.txt ~/backup/").level).toBe("dangerous");
    expect(tm.checkCommand("mv data.json $HOME/").level).toBe("dangerous");
    expect(tm.checkCommand("mv cache.db /dev/null").level).toBe("dangerous");
  });

  test("cp в /tmp/ → normal (копирование в temp не удаление)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("cp test.txt /tmp/backup.txt").level).toBe("normal");
    expect(tm.checkCommand("cp -r dir/ /tmp/backup/").level).toBe("normal");
  });

  test("mv внутри проекта → normal (легитимное перемещение)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("mv old-name.txt new-name.txt").level).toBe("normal");
    expect(tm.checkCommand("mv src/old.ts src/new.ts").level).toBe("normal");
  });

  test("node -e и bun -e → dangerous (скриптовые обходы)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand('node -e "require(\'fs\').unlinkSync(\'file.txt\')"').level).toBe("dangerous");
    expect(tm.checkCommand('bun -e "import { rmSync } from \'fs\'; rmSync(\'file.txt\')"').level).toBe("dangerous");
    expect(tm.checkCommand('python -c "import os; os.remove(\'file.txt\')"').level).toBe("dangerous");
    expect(tm.checkCommand('python3 -c "import os; os.remove(\'file.txt\')"').level).toBe("dangerous");
    expect(tm.checkCommand('perl -e "unlink \'file.txt\'"').level).toBe("dangerous");
    expect(tm.checkCommand('ruby -e "File.delete(\'file.txt\')"').level).toBe("dangerous");
  });

  test("find -delete и find -exec rm → dangerous", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("find . -name '*.log' -delete").level).toBe("dangerous");
    expect(tm.checkCommand("find . -exec rm {} \\;").level).toBe("dangerous");
    expect(tm.checkCommand("find /tmp/ -delete").level).toBe("dangerous");
  });

  test("find без -delete → safe (легитимный поиск)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("find . -name '*.ts'").level).toBe("safe");
    expect(tm.checkCommand("find src/ -type f").level).toBe("safe");
  });

  test("trash и osascript delete → dangerous", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("trash test.txt").level).toBe("dangerous");
    expect(tm.checkCommand('osascript -e \'tell app "Finder" to delete POSIX file "/tmp/file.txt"\'').level).toBe("dangerous");
    expect(tm.checkCommand("gio trash test.txt").level).toBe("dangerous");
  });

  test("> /dev/null → safe (безопасное перенаправление вывода)", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("ls > /dev/null 2>&1").level).toBe("safe");
    expect(tm.checkCommand("echo test > /dev/null").level).toBe("safe");
  });

  test("> /dev/sda или подобное → dangerous", () => {
    const tm = new TrustManager();
    expect(tm.checkCommand("dd if=/dev/zero of=/dev/sda").level).toBe("dangerous");
    expect(tm.checkCommand("cat file > /dev/sdb").level).toBe("dangerous");
  });

  test("repo mode блокирует dev-серверы (hang risk)", () => {
    const tm = new TrustManager();
    tm.setPermissionMode("repo");

    expect(tm.checkCommand("bun run dev").needsConfirmation).toBe(true);
    expect(tm.checkCommand("npm run dev").needsConfirmation).toBe(true);
    expect(tm.checkCommand("pnpm run dev").needsConfirmation).toBe(true);
    expect(tm.checkCommand("yarn dev").needsConfirmation).toBe(true);
    expect(tm.checkCommand("npx vite").needsConfirmation).toBe(true);
    expect(tm.checkCommand("npx serve").needsConfirmation).toBe(true);
    // But normal bun/npm run commands still work
    expect(tm.checkCommand("bun run build").needsConfirmation).toBe(false);
    expect(tm.checkCommand("bun run lint").needsConfirmation).toBe(false);
  });
});
