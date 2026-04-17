#!/usr/bin/env bun

import { spawnSync } from "child_process";
import { extname } from "path";

const cwd = process.cwd();
const prettierExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".md"]);

function runGit(args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

const changedTrackedFiles = runGit(["diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--"])
  .split(/\r?\n/)
  .filter(Boolean);

const untrackedFiles = runGit(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean);

const changedFiles = Array.from(new Set([...changedTrackedFiles, ...untrackedFiles])).filter((filePath) =>
  prettierExtensions.has(extname(filePath).toLowerCase())
);

if (!changedFiles.length) {
  process.exit(0);
}

const prettier = spawnSync("bunx", ["prettier", "--write", ...changedFiles], {
  cwd,
  stdio: "inherit",
});

if (prettier.error) {
  throw prettier.error;
}

if (prettier.status !== 0) {
  process.exit(prettier.status ?? 1);
}
