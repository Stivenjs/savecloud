#!/usr/bin/env bun

import { spawnSync } from "child_process";
import { extname } from "path";

const cwd = process.cwd();
const bunFormatExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".vue",
  ".svelte",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".mdx",
  ".graphql",
  ".gql",
  ".hbs",
  ".handlebars",
]);
const ignoredPathSegments = new Set([
  ".agents",
  ".vscode",
  ".github",
  ".husky",
  "build",
  "coverage",
  "node_modules",
  "src-tauri",
]);
const ignoredFileNames = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

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

const changedFiles = Array.from(new Set([...changedTrackedFiles, ...untrackedFiles])).filter((filePath) => {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const isIgnored = normalizedPath.split("/").some((segment) => ignoredPathSegments.has(segment));
  const fileName = normalizedPath.split("/").at(-1);
  return (
    !isIgnored &&
    fileName !== undefined &&
    !ignoredFileNames.has(fileName) &&
    bunFormatExtensions.has(extname(filePath).toLowerCase())
  );
});

if (!changedFiles.length) {
  process.exit(0);
}

const formatter = spawnSync("bun", ["fmt", ...changedFiles], {
  cwd,
  stdio: "inherit",
});

if (formatter.error) {
  throw formatter.error;
}

if (formatter.status !== 0) {
  process.exit(formatter.status ?? 1);
}
