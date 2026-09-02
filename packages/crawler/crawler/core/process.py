"""Process management, child process cleanup, and watchdog timers."""

import atexit
import os
import signal
import subprocess
import sys
import threading

from crawler.config import CREATE_NO_WINDOW, PROCESS_TIMEOUT_SECONDS


class ProcessManager:
    """Manages child processes, termination, and graceful exit cleanup."""

    @staticmethod
    def kill_chromium_children() -> None:
        """Kills any child processes belonging to current PID."""
        pid = os.getpid()
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    creationflags=CREATE_NO_WINDOW,
                    timeout=5,
                )
            else:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            pass

    @classmethod
    def cleanup_on_exit(cls) -> None:
        """Invoked automatically at interpreter shutdown to ensure no zombie processes."""
        try:
            if sys.platform == "win32":
                pid = os.getpid()
                result = subprocess.run(
                    ["wmic", "process", "where", f"ParentProcessId={pid}", "get", "ProcessId"],
                    capture_output=True,
                    text=True,
                    creationflags=CREATE_NO_WINDOW,
                    timeout=5,
                )
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if line.isdigit():
                        try:
                            subprocess.run(
                                ["taskkill", "/F", "/T", "/PID", line],
                                capture_output=True,
                                creationflags=CREATE_NO_WINDOW,
                                timeout=3,
                            )
                        except Exception:
                            pass
        except Exception:
            pass


# Register cleanup hook
atexit.register(ProcessManager.cleanup_on_exit)


class WatchdogTimer:
    """Watchdog timer to kill current process and children if it hangs beyond timeout."""

    def __init__(self, timeout: int = PROCESS_TIMEOUT_SECONDS):
        self.timeout = timeout
        self._timer: threading.Timer | None = None

    def start(self) -> None:
        def _die() -> None:
            sys.stderr.write(
                f"[watchdog] Timeout after {self.timeout}s — killing process tree\n"
            )
            ProcessManager.kill_chromium_children()
            os._exit(3)

        self._timer = threading.Timer(self.timeout, _die)
        self._timer.daemon = True
        self._timer.start()

    def cancel(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None
