# SaveCloud Agent Hooks

Agent hooks automate code quality checks, security validation, and context injection during AI-assisted development. Each hook executes at specific lifecycle points.

## Available Hooks

### format.json
**Event**: `PostToolUse`
**Command**: `bun run format`
**Timeout**: 60s
**Purpose**: Automatically format all modified code files using Prettier after the agent edits them.

### lint.json
**Event**: `PostToolUse`
**Command**: `bun run lint`
**Timeout**: 45s
**Purpose**: Run ESLint on backend TypeScript files after modifications to catch style/error violations.

### build-check.json
**Event**: `PostToolUse`
**Command**: `bun run build`
**Timeout**: 120s
**Purpose**: Verify backend TypeScript compilation after changes to catch type errors before deployment.

### session-context.json
**Event**: `SessionStart`
**Purpose**: Inject SaveCloud project context into new agent sessions (runtime, architecture, conventions).

### security.json
**Event**: `PreToolUse`
**Purpose**: Block dangerous command patterns (e.g., `rm -rf`, `DROP TABLE`) before execution.

## How Hooks Work

1. **Format Hook** runs after every file edit → ensures consistent code style
2. **Lint Hook** validates TypeScript syntax and conventions
3. **Build Check** compiles the backend to catch type errors early
4. **Session Context** loads project info at the start of each conversation
5. **Security** validates commands before allowing execution

## Troubleshooting

- Check hook output: Open the Output panel and select "GitHub Copilot Chat Hooks"
- Verify hook files: Ensure all `.json` files are in `.github/hooks/`
- Manual commands: Run `bun run format`, `bun run lint`, or `bun run build` to test hooks manually

## Adding Custom Hooks

To create new hooks:
1. Create a `.json` file in `.github/hooks/`
2. Define event type and command
3. Use [VS Code hook documentation](https://code.visualstudio.com/docs/copilot/customization/hooks) as reference
