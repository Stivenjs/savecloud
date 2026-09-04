import { $, Glob } from "bun";
import { join, resolve } from "node:path";

interface BuildConfig {
  readonly binaryName: string;
  readonly requiredPythonImports: string;
  readonly pipDependencies: readonly string[];
  readonly collectPackages: readonly string[];
  readonly hiddenImports: readonly string[];
  readonly windowsSystemDlls: readonly string[];
}

const CONFIG: BuildConfig = {
  binaryName: "savecloud_crawler",
  requiredPythonImports: "import PyInstaller, scrapling.fetchers",
  pipDependencies: ["pyinstaller", "scrapling[fetchers]"],
  collectPackages: ["crawler", "scrapling", "browserforge", "apify_fingerprint_datapoints", "curl_cffi", "patchright"],
  hiddenImports: ["_cffi_backend"],
  windowsSystemDlls: [
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "vcruntime140_threads.dll",
  ],
};

interface ProjectPaths {
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  readonly crawlerPackageDir: string;
  readonly pythonScript: string;
  readonly distDir: string;
  readonly buildDir: string;
  readonly specPath: string;
  readonly iconPath: string;
  readonly targetDir: string;
  readonly binaryFileName: string;
  readonly distBinaryPath: string;
}

function resolvePaths(): ProjectPaths {
  const scriptDir = import.meta.dir;
  const projectRoot = resolve(scriptDir, "..");
  const workspaceRoot = resolve(projectRoot, "..", "..");
  const isWindows = process.platform === "win32";
  const binaryFileName = isWindows ? `${CONFIG.binaryName}.exe` : CONFIG.binaryName;
  const distDir = join(projectRoot, "src-tauri", "resources");

  return {
    projectRoot,
    workspaceRoot,
    crawlerPackageDir: join(workspaceRoot, "packages", "crawler"),
    pythonScript: join(projectRoot, "src-tauri", "resources", "savecloud_crawler.py"),
    distDir,
    buildDir: join(projectRoot, "build"),
    specPath: join(projectRoot, `${CONFIG.binaryName}.spec`),
    iconPath: join(projectRoot, "src-tauri", "icons", "icon.ico"),
    targetDir: join(projectRoot, "src-tauri", "target"),
    binaryFileName,
    distBinaryPath: join(distDir, binaryFileName),
  };
}

const log = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  step: (step: number, total: number, msg: string) =>
    console.log(`\n\x1b[35m[STEP ${step}/${total}]\x1b[0m \x1b[1m${msg}\x1b[0m`),
  success: (msg: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg: string) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
};

/**
 * Discovers a working Python executable using Bun.which, falling back to standard
 * Windows installation directories if needed.
 */
async function findPythonExecutable(): Promise<string> {
  const binaryInPath = Bun.which("python") || Bun.which("python3");
  if (binaryInPath) {
    return binaryInPath;
  }

  // Windows fallback: check standard Python install directory in LOCALAPPDATA
  if (process.platform === "win32" && Bun.env.LOCALAPPDATA) {
    const pythonGlob = new Glob("Programs/Python/*/python.exe");
    for await (const matchedPath of pythonGlob.scan({ cwd: Bun.env.LOCALAPPDATA, absolute: true })) {
      if (await Bun.file(matchedPath).exists()) {
        log.info(`Discovered Python in AppData: ${matchedPath}`);
        return matchedPath;
      }
    }
  }

  throw new Error("Python executable not found in PATH or standard installation directories. Please install Python.");
}

/**
 * Ensures required Python packages (PyInstaller, Scrapling, etc.) are installed.
 */
async function ensurePythonDependencies(pythonBin: string): Promise<void> {
  log.info("Verifying Python build dependencies...");

  const checkProc = Bun.spawn([pythonBin, "-c", CONFIG.requiredPythonImports], {
    stdout: "ignore",
    stderr: "ignore",
  });

  const checkExitCode = await checkProc.exited;
  if (checkExitCode === 0) {
    log.info("All required Python dependencies are present.");
    return;
  }

  log.warn("Missing Python dependencies. Installing via pip...");
  const installProc = Bun.spawn([pythonBin, "-m", "pip", "install", ...CONFIG.pipDependencies], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const installExitCode = await installProc.exited;
  if (installExitCode !== 0) {
    throw new Error(
      `Failed to install Python dependencies via pip (exit code: ${installExitCode}). Please run 'pip install pyinstaller "scrapling[fetchers]"' manually.`
    );
  }

  log.success("Dependencies installed successfully.");
}

/**
 * Discovers and prepares Windows VC++ runtime DLLs for bundling if running on Windows.
 */
async function getWindowsDllArguments(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const system32Dir = "C:\\Windows\\System32";
  const dllArgs: string[] = [];

  for (const dllName of CONFIG.windowsSystemDlls) {
    const dllPath = join(system32Dir, dllName);
    const dllFile = Bun.file(dllPath);

    if (await dllFile.exists()) {
      log.info(`Bundling system runtime DLL: ${dllName}`);
      dllArgs.push("--add-binary", `${dllPath};.`);
    }
  }

  return dllArgs;
}

/**
 * Compiles the Python script into a standalone executable using PyInstaller.
 */
async function compileBinary(paths: ProjectPaths, pythonBin: string): Promise<void> {
  const dllArgs = await getWindowsDllArguments();

  const iconArgs: string[] = [];
  if (await Bun.file(paths.iconPath).exists()) {
    iconArgs.push("--icon", paths.iconPath);
  }

  const collectArgs = CONFIG.collectPackages.flatMap((pkg) => ["--collect-all", pkg]);
  const hiddenImportArgs = CONFIG.hiddenImports.flatMap((mod) => ["--hidden-import", mod]);

  const pyinstallerArgs: string[] = [
    "-m",
    "PyInstaller",
    "--clean",
    "--onefile",
    "--name",
    CONFIG.binaryName,
    "--distpath",
    paths.distDir,
    "--workpath",
    paths.buildDir,
    "--specpath",
    paths.buildDir,
    "--paths",
    paths.crawlerPackageDir,
    ...collectArgs,
    ...hiddenImportArgs,
    ...dllArgs,
    ...iconArgs,
    paths.pythonScript,
  ];

  log.info(`Compiling standalone binary with PyInstaller via ${pythonBin}...`);

  const pyinstallerProc = Bun.spawn([pythonBin, ...pyinstallerArgs], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await pyinstallerProc.exited;
  if (exitCode !== 0) {
    throw new Error(`PyInstaller compilation failed with exit code: ${exitCode}`);
  }
}

/**
 * Removes temporary build files and generated spec files.
 */
async function cleanupBuildArtifacts(paths: ProjectPaths): Promise<void> {
  log.info("Cleaning up temporary build artifacts...");

  try {
    const specInBuild = join(paths.buildDir, `${CONFIG.binaryName}.spec`);
    await $`rm -rf ${paths.buildDir} ${paths.specPath} ${specInBuild}`.quiet().nothrow();
    log.success("Clean up completed.");
  } catch (error) {
    log.warn(`Could not fully clean up temporary files: ${error}`);
  }
}

/**
 * Copies the compiled binary to Tauri debug target resources directories so
 * local development builds have access to the fresh executable immediately.
 */
async function syncBinaryToTauriTargets(paths: ProjectPaths): Promise<void> {
  const sourceFile = Bun.file(paths.distBinaryPath);
  if (!(await sourceFile.exists())) {
    log.warn(`Compiled binary not found at ${paths.distBinaryPath}, skipping sync.`);
    return;
  }

  // Check if target directory exists
  try {
    const targetStat = await Bun.file(paths.targetDir).stat();
    if (!targetStat.isDirectory()) return;
  } catch {
    // Target dir doesn't exist yet (no cargo build run yet)
    return;
  }

  log.info("Synchronizing crawler binary to Tauri target directories...");

  const targetResourceGlob = new Glob("**/debug/resources");
  const targetDirs = new Set<string>();

  // Add standard debug resources directory if it exists
  const standardDebug = join(paths.targetDir, "debug", "resources");
  try {
    if ((await Bun.file(standardDebug).stat()).isDirectory()) {
      targetDirs.add(standardDebug);
    }
  } catch {}

  // Scan for target triples (e.g. target/x86_64-pc-windows-msvc/debug/resources)
  try {
    for await (const matchedRelativeDir of targetResourceGlob.scan({
      cwd: paths.targetDir,
      onlyFiles: false,
    })) {
      const fullDir = join(paths.targetDir, matchedRelativeDir);
      try {
        if ((await Bun.file(fullDir).stat()).isDirectory()) {
          targetDirs.add(fullDir);
        }
      } catch {}
    }
  } catch (scanError) {
    log.warn(`Failed scanning Tauri target directory: ${scanError}`);
  }

  for (const destinationDir of targetDirs) {
    try {
      const destBinaryPath = join(destinationDir, paths.binaryFileName);
      await Bun.write(destBinaryPath, sourceFile);

      if (process.platform !== "win32") {
        await $`chmod 755 ${destBinaryPath}`.quiet().nothrow();
      }

      log.success(`Synced crawler binary to ${destBinaryPath}`);
    } catch (syncError) {
      log.warn(`Failed copying binary to ${destinationDir}: ${syncError}`);
    }
  }
}

async function main(): Promise<void> {
  const startTime = performance.now();
  const paths = resolvePaths();

  console.log("\x1b[1m=== SaveCloud Crawler Build Pipeline ===\x1b[0m");

  log.step(1, 5, "Validating Python entrypoint script");
  if (!(await Bun.file(paths.pythonScript).exists())) {
    throw new Error(`Python script not found at expected path: ${paths.pythonScript}`);
  }
  log.success(`Found script: ${paths.pythonScript}`);

  log.step(2, 5, "Locating Python environment and verifying dependencies");
  const pythonBin = await findPythonExecutable();
  log.info(`Using Python interpreter: ${pythonBin}`);
  await ensurePythonDependencies(pythonBin);

  log.step(3, 5, "Compiling Python script into standalone binary");
  await compileBinary(paths, pythonBin);
  log.success(`Binary successfully compiled: ${paths.distBinaryPath}`);

  log.step(4, 5, "Cleaning up build cache");
  await cleanupBuildArtifacts(paths);

  log.step(5, 5, "Synchronizing binary with Tauri development targets");
  await syncBinaryToTauriTargets(paths);

  const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\x1b[32m\x1b[1m=== Build finished successfully in ${durationSec}s ===\x1b[0m\n`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
