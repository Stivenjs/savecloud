# SaveCloud - Knowledge Base & Agent Architecture Guide

> This file serves as the **persistent knowledge base** of the SaveCloud project for Antigravity assistants and agents. It is loaded contextually in every session.

---

## 1. Project Overview

**SaveCloud** is a complete ecosystem for synchronizing, cloud-backing, and managing video game saves (Steam, non-Steam, and emulators).

- **Package Manager / Monorepo:** [Bun](https://bun.sh/) (`bun.lock`, workspaces: `apps/*`, `packages/*`).
- **Code Control & Languages:** TypeScript (strict), Rust 2021 (Tauri v2), Python 3.10+ (crawler).
- **Code Formatter:** `oxfmt` (`.oxfmtrc.json`).

---

## 2. Monorepo Map

```
savecloud/
├── apps/
│   ├── api/          # Fastify backend in Clean Architecture (Serverless AWS Lambda / Docker)
│   ├── desktop/      # Tauri v2 desktop application (Rust + React 19 + Vite)
│   ├── cli/          # Interactive and scriptable CLI in TypeScript/Bun
│   ├── web/          # Landing page and public documentation (React + Vite + Tailwind)
│   └── bun-lambda/   # Auxiliary runtime / layer for Lambda
├── packages/
│   ├── types/        # Shared types and interfaces (Config, Game, Save, Invite, etc.)
│   └── crawler/      # Python engine for web scraping and Cloudflare/Turnstile bypass
├── infra/            # Cloud infrastructure resources and templates
├── doc/              # Technical documentation (Docker, Deployment, Lua Plugins, Rust Plugins)
├── scripts/          # Development utilities, version synchronization, and API keys
└── tests/            # Test suite for integration, security, database, and facets
```

---

## 3. Application Architecture

### 3.1. Backend API (`apps/api`)

- **Framework:** Fastify with TypeScript.
- **Pattern:** Strict **Clean Architecture**:
  - `domain/`: Pure entities and ports (interfaces).
  - `application/`: Use cases (orchestration and business rules).
  - `infrastructure/`: Concrete adapters for S3, DynamoDB, cache, and hashing.
  - `interfaces/`: HTTP controllers (`interfaces/http/routes`), Lambda handler (`interfaces/lambda`), WebSockets.
- **Direct S3 Storage:** The API **never** streams save binary data through Lambda. Instead, it generates **presigned URLs** (PUT/GET) and manages the **Multipart Upload** lifecycle (for files ≥ 5 MB).
- **Key Routes:**
  - `/saves`: Listing saves, single and batch upload/download URLs (up to 500 items per request).
  - `/saves/multipart/*`: Initialization, part URLs retrieval, completion, and aborting.
  - `/saves/delete-game`, `/saves/rename-game`: S3 prefix management and migration.
  - `/invites`, `/share`: Invitation system and shared cloud memberships.
  - `/clips`: Uploading and listing gameplay clips/screenshots.
  - `/trash`: Cloud recycle bin (restore and permanent delete).
  - `/observability`: Telemetry and monitoring.
- **Dual Deployment:**
  - **AWS Serverless:** `serverless.yml` (API Gateway HTTP API + Lambda + S3 + CloudFront).
  - **Docker Self-Hosting:** `docker-compose.yml` (Fastify + MinIO + DynamoDB Local).

### 3.2. Desktop App (`apps/desktop`)

- **Rust Layer (`src-tauri/`):**
  - **Tauri v2:** Registers over 80 IPC commands in `ipc/handlers.rs`.
  - **Local Embedded Database:** SQLite embedded via `rusqlite` (WAL mode, catalog indexing, periodic maintenance/compaction in `sqlite/`).
  - **Process Detection:** `sysinfo` monitors running games and triggers **auto-upload on game exit** (`game_exit_sync`).
  - **File System Watcher:** `notify` and `notify-debouncer-mini` to detect local save file modifications.
  - **Big Picture & Gamepad:** Native XInput loop (`controller/`), rumble/vibration tester, 100% gamepad navigation, and customizable layouts (Xbox, PlayStation, Nintendo).
  - **P2P BitTorrent Engine:** Native integration with `librqbit` in Rust (`torrent/`), background downloads, and backing torrents up to the cloud.
  - **P2P/LAN Network:** Local peer discovery and inventory synchronization (`peer_lan`, `peer_inventory`) to transfer games without consuming internet bandwidth.
  - **Streaming:** Sunshine/Moonlight host and client integration (`streaming/`).
  - **Voice Commands:** Microphone listener module and intent recognition (`voice/`).
  - **Game Mode (Windows):** Power profile adjustment to high performance, reduced Game DVR capture overhead, and CPU priority elevation for the running game process (`game_mode/`).
  - **Lua Plugin System:** Isolated `mlua` (LuaJIT) virtual machine per plugin in `plugins/`, with lifecycle hooks (`on_init`, `on_game_start`, `on_game_exit`, `on_save_detected`, `on_pre_upload`, `on_post_upload`).
  - **Offline Steam Catalog:** Search, trending titles, and filter facets preloaded into SQLite from Steam and shared manifests (`steam_catalog/`).
  - **Coordinated Shutdown:** Multi-phase shutdown bus (`ShutdownBus` and `ShutdownCoordinator`) guaranteeing clean closing of SQLite, librqbit, and async background tasks.
- **Frontend Layer (`src/`):**
  - **React 19 + Vite + TypeScript**.
  - **UI & Styling:** Tailwind CSS + HeroUI (NextUI v3).
  - **State Management:** TanStack Query + modular stores.
  - **Primary Views:** Game Library, Game Detail, Historical Save Timeline (`SaveGraph`), Game Catalog, Friends/Shared Clouds, Sync History, Stream Viewer, and Remote Play.

### 3.3. CLI (`apps/cli`)

- Command-line interface built in Node/Bun.
- Two execution modes:
  - **Interactive Mode:** Visual terminal menu via Inquirer to add games, list, synchronize, and configure.
  - **Command Mode:** For scripting and automation (`savecloud add <id> <path>`, `savecloud upload <id>`, etc.).

### 3.4. Crawler & Extractor (`packages/crawler`)

- Modular Python engine for stealth web extraction and direct download link retrieval without manual intervention.
- **Multi-tier Strategy:**
  - Tier 1 (`FastFetch`): `curl_cffi` with TLS impersonation (100–200ms).
  - Tier 2 (`StealthBrowser`): `Scrapling` + `Patchright` (undetectable Playwright) with automated Cloudflare Turnstile resolution.
- Supported hosters: VikingFile, FileKeeper, Rootz, Buzzheavier, 1fichier, and a generic extractor.

---

## 4. Development Conventions & Rules

### 4.1. General Rules

1. **Preserve Comments & Typing:** Always maintain the integrity of existing comments and TypeScript/Rust typing documentation.
2. **No Binaries Through Lambda:** All upload and download logic must obtain presigned S3 URLs. Never stream or buffer raw file binaries through the API Lambda function.
3. **Rust Error Handling:** Use `Result<T, AppError>` or `thiserror`. Avoid `.unwrap()` or `.expect()` in critical paths or IPC commands; propagate descriptive errors to the frontend.
4. **Cross-Platform Compatibility:** The desktop app includes Windows-specific features (Game Mode, XInput, registry), but must compile and preserve `#[cfg(target_os = "...")]` guards for future portability.
5. **Zero Data Loss:** Before overwriting any local save downloaded from the cloud, a local backup must be created according to `keepBackupsPerGame`.

### 4.2. Frequent Commands

```bash
# Development
bun run dev             # Local Fastify API at http://localhost:3000
bun run desktop         # Desktop app in dev mode (Tauri + Vite)
bun run desktop:dev     # Desktop frontend only (Vite)
bun run web:dev         # Landing page in Vite
bun run cli             # Interactive CLI

# Type Checking & Compilation
bun run check:all       # TypeScript type checks across all packages
bun run cargo:check     # Syntax and dependency checks in Rust
bun run cargo:clippy    # Clippy linter in Rust
bun run build           # Compile backend
bun run desktop:build   # Package desktop installer / executable

# Testing & Formatting
bun run test            # API security and sharing tests
bun run test:api        # Full API test suite
bun run format          # Format entire repository with oxfmt
```

---

## 5. System Data Locations

- **User Configuration:**
  - Windows: `%APPDATA%\SaveCloud\config.json`
  - Linux/macOS: `~/.config/SaveCloud/config.json`
- **Local SQLite Database:**
  - Windows: `%APPDATA%\SaveCloud\savecloud.db`
- **Sync Debug Log:**
  - `%APPDATA%\SaveCloud\sync-debug.log`
- **Lua Plugins Folder:**
  - `%APPDATA%\SaveCloud\plugins\`
