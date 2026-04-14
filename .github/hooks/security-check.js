const blockedPatterns = ['rm -rf', 'DROP TABLE', ':(){:|:&};:', 'eval ', 'exec '];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const rawInput = await readStdin();
  let hookInput;

  try {
    hookInput = JSON.parse(rawInput);
  } catch {
    hookInput = { raw: rawInput };
  }

  const isDangerous = blockedPatterns.some((pattern) => JSON.stringify(hookInput).includes(pattern));

  if (isDangerous) {
    console.log(JSON.stringify({
      continue: false,
      stopReason: 'Dangerous command pattern detected. Review the command manually.'
    }));
    process.exit(2);
  }

  console.log(JSON.stringify({ continue: true }));
})();
