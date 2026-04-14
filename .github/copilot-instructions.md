---
name: savecloud-workspace-instructions
description: Comprehensive workspace instructions for SaveCloud project - cloud game save backup system with Fastify backend, Tauri desktop app, and AWS deployment. Covers build commands, Clean Architecture, Tauri patterns, deployment pitfalls, and development conventions.
---

# SaveCloud Workspace Instructions

## Project Overview

SaveCloud is a cloud-based game save backup system consisting of:
- **Backend**: Fastify API on AWS Lambda + S3 (Clean Architecture)
- **Desktop App**: Tauri 2 (React frontend + Rust backend)
- **CLI**: Interactive configuration tool

## Build and Development Commands

### Backend (Root Directory)
- `bun run build` - Compile TypeScript
- `bun run dev` - Start local Fastify server (port 3000, hot-reload)
- `bun run deploy:dev` - Deploy to AWS dev environment
- `bun run deploy:live` - Deploy to AWS live environment (with CloudFront)
- `bun run api-key` - Generate API key for dev
- `bun run api-key:live` - Generate API key for live
- `bun run cli` - Run interactive CLI
- `bun run build:cli` - Build standalone CLI executable

### Desktop App (apps/savecloud-desktop/)
- `bun run dev` - Start Vite dev server (port 1420)
- `bun run desktop` - Start Tauri dev (includes Vite)
- `bun run desktop:build` - Build desktop installer
- `bun run icon` - Generate app icons
- `bun run latest-json` - Generate updater JSON

### Shared
- `bun run format` - Format code with Prettier
- `bun run lint` - Lint TypeScript (backend only)

## Architecture Decisions

### Backend (Clean Architecture)
- **Dependency Flow**: interfaces → application → domain ← infrastructure
- **Domain Layer**: Business entities and ports (interfaces)
- **Application Layer**: Use cases (orchestration logic)
- **Infrastructure Layer**: AWS implementations (S3, DynamoDB)
- **Interfaces Layer**: HTTP routes, Lambda handlers
- **Path Aliases**: Use `@domain/`, `@application/`, etc. (never bare paths)

### Desktop App (Tauri 2)
- **IPC Pattern**: Commands via `#[tauri::command]` in Rust, invoked from React
- **State Management**: Zustand + React Query (10min stale time for config)
- **Frontend Structure**: Feature-driven with lazy loading
- **Rust Structure**: Modular commands (config, sync, steam, cloud, etc.)

## Key Conventions

### TypeScript
- Strict mode enabled
- ES2022 target, CommonJS modules
- Use `Result<T, String>` for errors (not custom error types)
- Timing-safe secret comparison with `timingSafeEqual()`

### Authentication
- API key in `x-api-key` header
- Access tokens: `sc1.{payload}.{hmac}` format
- WebSocket auth via query params

### S3 Storage
- Structure: `{userId}/{gameId}/` for saves, `backups/` for archives
- Lifecycle rules auto-delete expired tokens (7 days)
- Transfer Acceleration optional (extra costs)

### Tauri Commands
- Register all commands in `generate_handler![]`
- Use owned types in async commands (no `&str`)
- State injection with `State<'_, Type>`

## Potential Pitfalls

### Deployment
- **Stage Isolation**: Dev/live are separate AWS stacks
- **API Key Embedding**: CLI requires env vars at build time
- **CloudFront Propagation**: Changes take ~20 minutes
- **Lambda Cold Starts**: ~500ms on first request

### Development
- **S3 Throttle**: Limit presigned URL concurrency to 50
- **Multipart Limits**: Max 200 parts per upload
- **Token Rotation**: Existing tokens fail on secret change
- **Unregistered Commands**: Fail silently in Tauri

### Environment
- **Bun vs Node**: Dev uses Bun, production uses Node 24
- **Config Paths**: OS-specific, fails on non-standard installs
- **No Tests**: Manual testing only

## Key Files and Directories

### Backend
- `src/interfaces/http/app.ts` - Fastify app setup
- `src/interfaces/lambda/handler.ts` - AWS Lambda entry
- `src/application/use-cases/` - Business logic (22 use cases)
- `src/domain/ports/` - Repository interfaces
- `src/infrastructure/persistence/` - S3/DynamoDB implementations

### Desktop App
- `apps/savecloud-desktop/src/App.tsx` - React entry
- `apps/savecloud-desktop/src-tauri/src/lib.rs` - Rust entry
- `apps/savecloud-desktop/src-tauri/src/ipc/handlers.rs` - Command registration
- `apps/savecloud-desktop/src-tauri/tauri.conf.json` - Tauri config

### Configuration
- `serverless.yml` - AWS deployment config
- `resources.dev.yml` / `resources.live.yml` - CloudFormation
- `.env` - Local environment variables

## Documentation Links

- [Deployment Guide](../doc/DEPLOYMENT.md) - Full AWS setup and configuration
- [Plugins Development](../doc/PLUGINS_DEV.md) - Lua plugin API
- [Rust Plugins](../doc/RUST_PLUGINS.md) - Plugin architecture
- [README](../README.md) - Project overview and scripts

## Development Workflow

1. **Backend Changes**: `bun run dev` for local testing, `bun run deploy:dev` for AWS
2. **Desktop Changes**: `bun run desktop` for development, `bun run desktop:build` for release
3. **CLI Changes**: `bun run cli` for testing, `bun run build:cli` for executable
4. **Version Sync**: `bun run version` to update from git tags

## Testing and Validation

- **Local Backend**: `bun run invoke:local` to test Lambda handler
- **AWS Verification**: Check S3 console for uploaded files, CloudFront for live URLs
- **Desktop**: Manual testing only (no automated tests)
- **Integration**: Deploy to dev stage for end-to-end testing

## Agent Hooks

Automated code quality and safety checks on file edits. Configure hooks in `.github/hooks/`:

- **format.json** - Auto-format all edited files (Prettier) after save
- **lint.json** - Lint backend TypeScript (ESLint) post-edit
- **build-check.json** - Verify TypeScript compilation after changes
- **session-context.json** - Inject project context at session start
- **security.json** - Block dangerous command patterns pre-execution

See [Hooks README](./hooks/README.md) for details. Hooks enforce consistency and catch errors early without manual intervention.