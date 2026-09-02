"""Browser detection, installation, and Scrapling fetchers bootstrap."""

import os
import subprocess
import sys
from typing import Any

from crawler.config import CREATE_NO_WINDOW


class BrowserManager:
    """Handles browser binary detection, environment setup, and installation."""

    _stealthy_fetcher: Any = None
    _fetcher: Any = None

    @classmethod
    def setup_environment(cls) -> None:
        """Configures default browser paths if not explicitly provided."""
        if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ:
            home = os.path.expanduser("~")
            if sys.platform == "win32":
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(
                    home, "AppData", "Local", "ms-playwright"
                )
            elif sys.platform == "darwin":
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(
                    home, "Library", "Caches", "ms-playwright"
                )
            else:
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(
                    home, ".cache", "ms-playwright"
                )

    @classmethod
    def ensure_fetchers_installed(cls) -> bool:
        """Loads or installs Scrapling fetchers (curl_cffi and patchright)."""
        if cls._stealthy_fetcher is not None and cls._fetcher is not None:
            return True

        try:
            from scrapling.fetchers import Fetcher, StealthyFetcher
            cls._stealthy_fetcher = StealthyFetcher
            cls._fetcher = Fetcher
            return True
        except ModuleNotFoundError as exc:
            missing = str(exc)
            if "curl_cffi" not in missing and "scrapling.fetchers" not in missing:
                raise

        if getattr(sys, "frozen", False):
            raise RuntimeError(
                "Scrapling fetchers are not bundled in the compiled executable. "
                "Please ensure 'scrapling[fetchers]' is included in your PyInstaller build."
            )

        cmd = [sys.executable, "-m", "pip", "install", "--user", "scrapling[fetchers]"]
        result = subprocess.run(
            cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW
        )
        if result.returncode != 0:
            raise RuntimeError(
                "No se pudieron instalar los extras de Scrapling.\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

        from scrapling.fetchers import Fetcher, StealthyFetcher
        cls._stealthy_fetcher = StealthyFetcher
        cls._fetcher = Fetcher
        return True

    @classmethod
    def get_fetcher(cls) -> Any:
        cls.ensure_fetchers_installed()
        return cls._fetcher

    @classmethod
    def get_stealthy_fetcher(cls) -> Any:
        cls.ensure_fetchers_installed()
        return cls._stealthy_fetcher

    @classmethod
    def is_missing_browser_error(cls, exc: Exception | None) -> bool:
        if not exc:
            return False
        msg = str(exc).lower()
        indicators = (
            "executable doesn't exist",
            "executable doesnt exist",
            "patchright install",
            "playwright install",
            "browsertype.launch",
            "chrome-win64",
            "chromium-",
            "please run the following command to download new browsers",
        )
        return any(ind in msg for ind in indicators)

    @classmethod
    def is_browser_installed(cls) -> bool:
        try:
            from patchright.sync_api import sync_playwright
            with sync_playwright() as p:
                exe = p.chromium.executable_path
                return bool(exe and os.path.isfile(exe))
        except Exception:
            return False

    @classmethod
    def ensure_browsers_installed(cls) -> None:
        """Installs the required Chromium browser using Patchright or Playwright drivers."""
        cls.setup_environment()
        last_error = None
        browsers_path = os.environ.get(
            "PLAYWRIGHT_BROWSERS_PATH",
            os.path.join(os.path.expanduser("~"), "AppData", "Local", "ms-playwright")
            if sys.platform == "win32"
            else os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"),
        )
        try:
            os.makedirs(browsers_path, exist_ok=True)
        except Exception:
            pass
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path

        # 1. Try Patchright driver
        try:
            from patchright._impl._driver import compute_driver_executable, get_driver_env
            driver_executable, driver_cli = compute_driver_executable()
            env = get_driver_env()
            env["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path
            sys.stderr.write(
                f"[Scrapling] Instalando Chromium usando driver Patchright: {driver_executable}\n"
            )
            cmd = [driver_executable, driver_cli, "install", "chromium"]
            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                sys.stderr.write("[Scrapling] Navegadores Patchright instalados exitosamente.\n")
                return
            last_error = f"Patchright driver error: {result.stderr or result.stdout}"
        except Exception as e:
            last_error = f"Patchright import error: {e}"

        # 2. Try Playwright driver
        try:
            from playwright._impl._driver import compute_driver_executable, get_driver_env
            driver_executable, driver_cli = compute_driver_executable()
            env = get_driver_env()
            env["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path
            sys.stderr.write(
                f"[Scrapling] Instalando Chromium usando driver Playwright: {driver_executable}\n"
            )
            cmd = [driver_executable, driver_cli, "install", "chromium"]
            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                sys.stderr.write("[Scrapling] Navegadores Playwright instalados exitosamente.\n")
                return
            last_error = f"{last_error} | Playwright driver error: {result.stderr or result.stdout}"
        except Exception as e:
            last_error = f"{last_error} | Playwright import error: {e}"

        # 3. CLI fallback when not frozen
        if not getattr(sys, "frozen", False):
            try:
                cmd = [sys.executable, "-m", "patchright", "install", "chromium"]
                res = subprocess.run(
                    cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW
                )
                if res.returncode == 0:
                    sys.stderr.write("[Scrapling] Navegadores instalados via python -m patchright.\n")
                    return
            except Exception as e:
                last_error = f"{last_error} | CLI error: {e}"

            try:
                from scrapling.cli import install as scrapling_install
                scrapling_install([], standalone_mode=False)
                sys.stderr.write("[Scrapling] Navegadores instalados via scrapling.cli.\n")
                return
            except Exception as e:
                last_error = f"{last_error} | Scrapling CLI error: {e}"

        raise RuntimeError(f"No se pudieron instalar los navegadores de Scrapling: {last_error}")


# Run initial environment setup
BrowserManager.setup_environment()
