const QUICK_CONTEXT =
  'SaveCloud project initialized | Runtime: Bun 1.3.10 | Backend: Fastify/AWS Lambda | Desktop: Tauri 2 | No tests configured - manual testing only';
const CONTEXT_FILE_URL = new URL('../copilot-instructions.md', import.meta.url);
const MAX_CONTEXT_CHARS = 15000;

let instructions = '';

try {
  instructions = await Bun.file(CONTEXT_FILE_URL).text();

  if (instructions.length > MAX_CONTEXT_CHARS) {
    instructions = `${instructions.slice(0, MAX_CONTEXT_CHARS)}\n\n[truncated by session-context hook]`;
  }
} catch (error) {
  instructions = `Unable to load .github/copilot-instructions.md (${error?.message ?? 'unknown error'})`;
}

const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `${QUICK_CONTEXT}\n\n${instructions}`
  }
};

console.log(JSON.stringify(output));
