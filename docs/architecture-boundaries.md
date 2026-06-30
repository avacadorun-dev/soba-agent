# Architecture Boundaries

This project is retiring `src/core` as a bucket for important code. New code must
have an explicit owner layer.

## Target Layers

```text
src/kernel          pure contracts, value objects, policies, and ports
src/engine          agent turn orchestration and runtime coordination logic
src/application     public use-case API for CLI, TUI, ACP, and other hosts
src/infrastructure  filesystem, process, network, provider, MCP, and persistence implementations
src/composition     concrete dependency wiring only
src/apps            executable hosts and delivery entrypoints
src/adapters        protocol adapters
src/ui              terminal UI and rendering
src/shared          pure shared helpers, constants, and types
```

## Dependency Rules

The executable boundary gate is `bun run check:boundaries`.

```ts
const rules = [
  {
    from: "src/shared/**",
    deny: [
      "src/application/**",
      "src/engine/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "node:",
      "bun:",
      "@opentui/",
    ],
  },
  {
    from: "src/kernel/**",
    deny: [
      "src/application/**",
      "src/engine/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "node:",
      "bun:",
      "@opentui/",
    ],
  },
  {
    from: "src/engine/**",
    deny: [
      "src/application/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "node:",
      "bun:",
    ],
  },
  {
    from: "src/application/**",
    deny: [
      "src/engine/**",
      "src/composition/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "@opentui/",
    ],
  },
  {
    from: "src/infrastructure/**",
    deny: [
      "src/engine/**",
      "src/composition/**",
      "src/apps/**",
      "src/ui/**",
    ],
  },
  {
    from: "src/adapters/**",
    deny: [
      "src/engine/**",
      "src/infrastructure/**",
      "src/composition/**",
      "src/apps/**",
      "src/ui/**",
    ],
  },
  {
    from: "src/apps/**",
    allowOnlyPublicApplicationApi: true,
  },
  {
    from: "src/ui/**",
    allowOnlyPublicApplicationApi: true,
  },
];
```

For `allowOnlyPublicApplicationApi`, delivery layers may import their own
delivery concerns and `src/shared/**`; executable ACP host code may import the
ACP protocol adapter, and the CLI host may import terminal UI and terminal
integration modules it launches directly. Every other cross-layer dependency
must go through public application API modules. Delivery layers must not import
`src/core`, `src/kernel`, `src/engine`, broad `src/infrastructure`, or
`src/composition` directly.

## Laws

1. Do not add a file to `kernel` if it imports `node:*`, `bun:*`, `fs`, `path`,
   `process`, `fetch`, OpenTUI, MCP, OpenResponses, or JSONL persistence.
2. Do not add a file to `shared` if it imports `node:*`, `bun:*`, `fs`, `path`,
   `process`, OpenTUI, delivery layers, application, engine, or infrastructure.
3. Do not add a file to `engine` if it imports `node:*`, `bun:*`, concrete
   persistence, local process/filesystem/network clients, OpenTUI, MCP, or
   provider implementations. Engine receives those capabilities through ports.
4. Do not add feature code to `composition`. Composition creates objects and
   wires dependencies.
5. Do not import `engine` or concrete infrastructure from `application`.
   Application uses ports, services, and DTOs.
6. Do not import `engine` from `apps`, `adapters`, or `ui`. Delivery layers work
   through public application API.
7. Do not add another broad manager without an explicit owner layer:
   `KernelPolicy`, `EngineCoordinator`, `ApplicationService`,
   `InfrastructureStore`, or `CompositionFactory`.
8. Do not add broad root barrel exports. Use context-level `public.ts` modules
   such as `src/kernel/tools/public.ts`, `src/application/cli/public.ts`, or
   `src/application/runtime/public.ts`.

## Migration Order

1. Create architecture guardrails and make the rules executable.
2. Move runtime composition out of `application` into `composition`.
3. Move provider/OpenResponses, local tools, and MCP implementations into
   `infrastructure`.
4. Introduce kernel contracts and split session transcript from persistence.
5. Extract engine turn components from the legacy `AgentLoop`.
6. Move CLI, TUI, and ACP access to public application APIs only.
7. Delete retired `src/core` compatibility imports.

## Final Gate

Before this refactor is complete, all of these must pass:

```bash
bun run lint
bun run typecheck
bun test
bun run build
bun run check:boundaries
```
