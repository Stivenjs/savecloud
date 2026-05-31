---
name: savecloud-workspace-instructions
description: Comprehensive workspace instructions for SaveCloud project - cloud game save backup system with Fastify backend, Tauri desktop app, and AWS deployment. Covers build commands, Clean Architecture, Tauri patterns, deployment pitfalls, and development conventions.
---

# SaveCloud AI Agent Instructions

SaveCloud is a **full-stack cloud save synchronization platform** for video games, consisting of three applications: Backend API (Fastify), CLI (TypeScript + TUI), and Desktop App (Tauri + React).

**Runtime**: Bun 1.3.10 | **Backend**: Fastify on AWS Lambda | **Desktop**: Tauri 2 + React 19

---

## Quick Start for Agents

### Development Commands

```bash
# Backend API (hot-reload on port 3000)
bun run dev

# Desktop app (Tauri + Vite)
bun run desktop

# CLI interactive menu
bun run cli

# Build TypeScript
bun run build

# Generate API key
bun run api-key
```

### Deployment

```bash
bun run deploy:dev     # AWS Lambda (dev stage)
bun run deploy:live    # AWS Lambda (live stage)
```

---

## Architecture Patterns

### Backend: Clean Architecture (Hexagonal)

```
interfaces/ (HTTP/Lambda handlers)
    ↓
application/ (use-cases)
    ↓
domain/ (entities + port interfaces) ←— infrastructure/ (implementations)
```

**Dependency direction**: Always inward (interfaces → application → domain)

**Example**:

- Port: `SaveRepository` interface defined in `domain/ports/`
- Implementation: `S3SaveRepository` in `infrastructure/persistence/`
- Use Case: `DeleteBackupUseCase` accepts repository as dependency
- HTTP Handler: Injects use case via container

### Desktop: React ↔ Tauri IPC ↔ Rust

- Frontend components call Rust commands via `invoke<T>("cmd_name")`
- State managed with Zustand (global) + React Query v5 (server state)
- Rust backend handles file I/O, Steam integration, P2P sync

### CLI: Layered (Domain → Application → Infrastructure)

Mirrors backend architecture with CLI-specific concerns (config I/O, path scanning, Steam integration).

---

## Key Conventions & Patterns

| Area               | Convention                                 | Example                                                  |
| ------------------ | ------------------------------------------ | -------------------------------------------------------- |
| **Backend**        | Use case with `execute()` method           | `class GetUploadUrlUseCase { async execute(gameId) {} }` |
| **Imports**        | Prefer path aliases for cross-module imports; allow relative imports for same-directory files | `import { User } from "@domain/entities"`                |
| **DI**             | Constructor injection of repositories      | `constructor(private saveRepo: SaveRepository)`          |
| **Validation**     | TypeBox schemas in interfaces layer        | TypeScript strict mode enabled                           |
| **Tauri Commands** | `#[tauri::command] pub async fn name() {}` | Must register in `ipc/handlers.rs`                       |
| **React Hooks**    | Query + Tauri invoke bridge                | `useQuery({ queryFn: () => invoke<T>("cmd") })`          |
| **Zustand**        | Global state via `create()`                | `NotificationStore`, `SyncStore`                         |
| **Error Handling** | `Result<T, String>` (Rust)                 | No custom error types yet                                |
| **Modules**        | One concern per module                     | `sync/`, `steam/`, `config/`                             |

### Import Rules

- Use path aliases for imports that cross module boundaries: `@domain`, `@application`, `@infrastructure` (preferred for clarity and tooling). Example: `import { User } from "@domain/entities";`
- Use relative imports only for files that live in the same directory (sibling files). Example: `import { Component } from "./Component";`
- Import from index files when convenient: `import { Thing } from "@domain";` or `import { Thing } from "./index";`
- Avoid mixing alias and relative styles inside the same module; choose one convention per directory to keep imports consistent. When in doubt, prefer the alias for cross-module boundaries and the relative form for local (same-directory) references.

---

## Key Files & Directories

### Backend

- **[apps/api/src/domain/](../apps/api/src/domain/)** — Entities, business rules, port interfaces
- **[apps/api/src/application/use-cases/](../apps/api/src/application/use-cases/)** — Use case implementations
- **[apps/api/src/infrastructure/](../apps/api/src/infrastructure/)** — AWS SDK, S3, DynamoDB implementations
- **[apps/api/src/interfaces/http/](../apps/api/src/interfaces/http/)** — Fastify routes, schema validation
- **[apps/api/src/interfaces/lambda/](../apps/api/src/interfaces/lambda/)** — Lambda handler for serverless

### Desktop

- **[apps/desktop/src/](../apps/desktop/src/)** — React components, Zustand stores, Tauri IPC hooks
- **[apps/desktop/src-tauri/src/](../apps/desktop/src-tauri/src/)** — Rust backend (Tauri commands)
- **[apps/desktop/src/services/](../apps/desktop/src/services/)** — API client, Tauri invoke wrappers
- **[tauri.conf.json](../apps/desktop/src-tauri//tauri.conf.json)** — Tauri configuration, capabilities, permissions

### CLI

- **[apps/cli/domain/](../apps/cli/domain/)** — Entities (Config, ConfiguredGame)
- **[apps/cli/application/use-cases/](../apps/cli/application/use-cases/)** — Add, remove, list games; scan paths
- **[apps/cli/infrastructure/](../apps/cli/infrastructure/)** — Steam integration, file system scanner, config I/O

### Configuration

- **[serverless.yml](../serverless.yml)** — AWS Lambda, API Gateway, DynamoDB, S3 (recursos en [infra/resources.*.yml](../infra/))
- **[apps/desktop/src-tauri/Cargo.toml](../apps/desktop/src-tauri/Cargo.toml)** — Rust dependencies
- **[tsconfig.json](../tsconfig.json)** — Path aliases, strict mode enabled

---

## Critical Implementation Gotchas

| Issue                                   | Impact                                   | Prevention                                                                |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Unregistered Tauri commands             | Command fails silently                   | Always update `src-tauri/src/ipc/handlers.rs` `generate_handler![]` macro |
| Missing capabilities.json               | Permission denied silently               | Add capability for any new Tauri feature. When implementing Rust features that touch the filesystem, network, or OS processes, prompt the user to ensure the required capability is added to `tauri.conf.json` or `capabilities.json` (if you cannot edit it directly). |
| S3 presigned URL throttling             | 503 SlowDown at 500+ concurrent requests | Use concurrency limits (e.g., `PRESIGN_CONCURRENCY=50`)                   |
| API Gateway auth cache                  | 401 leaked between requests              | Use Host as identity source, disable TTL cache                            |
| Non-owned types in async Tauri commands | Won't compile                            | Always use `String`, `Vec<T>`, never `&str` or `&[T]`                     |
| Token secret mismatch                   | Auth fails across Lambda invocations     | Store in AWS SSM Parameter Store or external vault                        |
| Relative imports mixing                 | TypeScript confusion                     | Prefer path aliases for inter-module imports; allow relative imports for same-directory files. Avoid mixing styles within the same module to reduce confusion.                      |

### Concurrency & AWS Limits

- **S3 presigned URLs**: Max 500/sec per account; implement queue if needed
- **Lambda cold starts**: ~1-2s on first invoke; use provisioned concurrency in production
- **DynamoDB**: Default limits; use on-demand billing or set capacity
- **WebSocket connections**: Max 600 concurrent per API Gateway; implement reconnect logic

---

## Testing

**Important**: No test framework is currently configured in this repository — testing is manual by default. If you (or a collaborator) choose to add automated tests later, you must update project configuration, add test scripts, and adjust CI before running them.

Recommended frameworks to use when adding tests (only apply these after configuring the runner):

- Backend: **vitest** + **supertest** (Fastify) for use cases and Lambda handlers
- Desktop: **vitest** + **React Testing Library** for components
- Rust: built-in `#[tokio::test]` with mocking

- Focus on edge cases: S3 presign throttling, token expiry, WebSocket lifecycle, file sync race conditions

If a user or automation requests to run tests but no test framework is configured, politely inform them that no test runner is present and suggest these options:

- Configure a test runner (example commands to install a minimal Vitest setup):

```bash
# Install vitest and supertest for backend
bun add -d vitest supertest

# Add a test script to package.json: "test": "vitest"
```

- Or perform manual validation steps and list what to check (end-to-end flows, critical edge cases) until automated tests are added.

---

## Related Documentation

- **[Deployment Guide](../doc/DEPLOYMENT.md)** — AWS setup, environment variables, secrets management
- **[Desktop App README](../apps/desktop/README.md)** — React + Tauri architecture, build instructions
- **[GitHub Hooks README](../.github/hooks/README.md)** — Development environment setup
- **[Plugins Dev Guide](../doc/PLUGINS_DEV.md)** — Tauri plugin development (if applicable)

---

## TypeScript Configuration

- **Strict mode**: Enabled globally
- **Path aliases**: Defined in [tsconfig.json](../tsconfig.json)
  - `@domain` → `apps/api/src/domain`
  - `@application` → `apps/api/src/application`
  - `@infrastructure` → `apps/api/src/infrastructure`
  - `@interfaces` → `apps/api/src/interfaces`
  - Same pattern for CLI app

---

## Code Style

- **Formatter**: Prettier (configured in package.json)
- **Linter**: ESLint (TypeScript)
- **Pre-commit**: Husky + lint-staged (auto-format on commit)

```bash
bun run format                 # Format all files
bun run format:changed         # Format only changed files
bun run lint                   # Lint backend code
```

---

## Secrets & Configuration

- **API keys**: Generated via `bun run api-key`, stored in `.env`
- **AWS credentials**: Required for deployment (set in `.env` or AWS CLI)
- **Environment files**: `.env` (git-ignored), `.env.example` (for reference)

See [Deployment Guide](../doc/DEPLOYMENT.md) for full setup.

---

## Game Integration Features

- **Steam**: Integrated via `infrastructure/steamAppNames.ts`, saves located in game-specific directories
- **Save locations**: Platform-specific paths (Windows: `%APPDATA%`, Linux: `~/.local/share/`, macOS: `~/Library/`)
- **P2P Sync**: librqbit Rust plugin for distributed sync
- **File extensions**: Auto-detected from game-specific save extensions in `infrastructure/saveExtensions.ts`

---

## When Adding New Features

1. **Define port interface** in `domain/ports/` (dependency inversion)
2. **Implement use case** in `application/use-cases/` (orchestration)
3. **Add repository implementation** in `infrastructure/` (concrete AWS SDK calls)
4. **Expose HTTP endpoint** in `interfaces/http/routes/` (validation + response)
5. **For Desktop**: Register Tauri command in `src-tauri/src/ipc/handlers.rs` and update `capabilities.json`
6. **For CLI**: Add command in `apps/cli/commands/` and register in menu

---

## Agent Best Practices

1. **Always check existing patterns** — Look at similar features before implementing
2. **Verify imports compile** — Use `bun run build` before committing
3. **Test Tauri commands** — Manually invoke via desktop app to catch registration issues
4. **Check AWS limits** — Review concurrency/throttling behavior for production readiness
5. **Link to docs, don't duplicate** — Reference [Deployment Guide](../doc/DEPLOYMENT.md) instead of rewriting
6. **No breaking changes to domain** — Clean Architecture strictly enforces inward dependencies
7. **Type everything** — TypeScript strict mode is non-negotiable

---

## Quick Command Reference

| Task             | Command               |
| ---------------- | --------------------- |
| Start API        | `bun run dev`         |
| Start Desktop    | `bun run desktop`     |
| Build backend    | `bun run build`       |
| Deploy to dev    | `bun run deploy:dev`  |
| Deploy to live   | `bun run deploy:live` |
| Generate API key | `bun run api-key`     |
| Run CLI          | `bun run cli`         |
| Format code      | `bun run format`      |
| Check Rust       | `bun run cargo:check` |

---

**Last updated**: April 2026 | **Package Manager**: Bun 1.3.10 | **Node Runtime**: 24.x (Lambda)
