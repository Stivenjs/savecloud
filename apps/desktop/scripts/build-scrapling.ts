import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const pythonScriptPath = path.join(projectRoot, "src-tauri", "resources", "scrapling_fetch.py");
const distDir = path.join(projectRoot, "src-tauri", "resources");
const buildDir = path.join(projectRoot, "build");
const specPath = path.join(projectRoot, "scrapling_fetch.spec");
const iconPath = path.join(projectRoot, "src-tauri", "icons", "icon.ico");

const iconArgs: string[] = [];
if (fs.existsSync(iconPath)) {
  iconArgs.push("--icon", iconPath);
}

console.log("Starting Scrapling Python compilation using PyInstaller...");

if (!fs.existsSync(pythonScriptPath)) {
  console.error(`Error: Python script not found at ${pythonScriptPath}`);
  process.exit(1);
}

function findPythonPath(): string {
  const check = spawnSync("python", ["--version"], { shell: true });
  if (check.status === 0) return "python";

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const pythonDir = path.join(localAppData, "Programs", "Python");
    if (fs.existsSync(pythonDir)) {
      try {
        const versions = fs.readdirSync(pythonDir);
        for (const ver of versions) {
          const pyPath = path.join(pythonDir, ver, "python.exe");
          if (fs.existsSync(pyPath)) {
            console.log(`Found python at: ${pyPath}`);
            return pyPath;
          }
        }
      } catch (e) {}
    }
  }
  return "python";
}

const pythonBin = findPythonPath();

console.log("Checking if pyinstaller is installed...");
const checkPyInstaller = spawnSync(pythonBin, ["-m", "PyInstaller", "--version"], { shell: true, encoding: "utf8" });

if (checkPyInstaller.status !== 0) {
  console.log("pyinstaller not found. Attempting to install it via pip...");
  const installPip = spawnSync(pythonBin, ["-m", "pip", "install", "pyinstaller", "scrapling"], {
    shell: true,
    stdio: "inherit",
  });
  if (installPip.status !== 0) {
    console.error("Failed to install pyinstaller and scrapling via pip. Please install them manually.");
    process.exit(1);
  }
}

console.log("Running PyInstaller to compile scrapling_fetch.py...");
const pyinstallerCmd = spawnSync(
  pythonBin,
  [
    "-m",
    "PyInstaller",
    "--clean",
    "--onefile",
    "--name",
    "scrapling_fetch",
    "--distpath",
    distDir,
    "--workpath",
    buildDir,
    "--specpath",
    projectRoot,
    "--collect-all",
    "scrapling",
    "--collect-all",
    "browserforge",
    "--collect-all",
    "apify_fingerprint_datapoints",
    "--collect-all",
    "curl_cffi",
    "--collect-all",
    "patchright",
    "--hidden-import",
    "_cffi_backend",
    ...iconArgs,
    pythonScriptPath,
  ],
  { shell: true, stdio: "inherit" }
);

if (pyinstallerCmd.status !== 0) {
  console.error("PyInstaller compilation failed.");
  process.exit(1);
}

console.log("Cleaning up temporary build files...");
try {
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  if (fs.existsSync(specPath)) {
    fs.unlinkSync(specPath);
  }
  console.log("Clean up completed successfully!");
} catch (e) {
  console.warn("Could not fully clean up temporary files:", e);
}

console.log(`Compilation successful! Standalone binary written to ${distDir}`);
