#!/usr/bin/env bun
import { join } from "node:path";

process.env.SOBA_PACKAGE_ROOT ??= join(import.meta.dir, "..");
process.env.SOBA_BUNDLED_SKILLS_PATH ??= join(import.meta.dir, "..", "skills");

await import(join(import.meta.dir, "..", "dist", "cli.js"));
