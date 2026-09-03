"""Session cache manager for persisting Cloudflare clearance and hoster cookies."""

import json
import os
import sys
import time
from typing import Any
from urllib.parse import urlparse


class SessionManager:
    """Manages cross-invocation session cookies (e.g. cf_clearance) and user-agents by host."""

    @classmethod
    def get_session_file_path(cls) -> str:
        home = os.path.expanduser("~")
        if sys.platform == "win32":
            base_dir = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
            target_dir = os.path.join(base_dir, "SaveCloud")
        elif sys.platform == "darwin":
            target_dir = os.path.join(home, "Library", "Application Support", "SaveCloud")
        else:
            base_dir = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
            target_dir = os.path.join(base_dir, "savecloud")

        os.makedirs(target_dir, exist_ok=True)
        return os.path.join(target_dir, "crawler_sessions.json")

    @classmethod
    def _normalize_host(cls, host_or_url: str) -> str:
        if "://" in host_or_url:
            try:
                host_or_url = urlparse(host_or_url).netloc
            except Exception:
                pass
        return host_or_url.lower().split(":")[0].strip()

    @classmethod
    def load_all_sessions(cls) -> dict[str, dict[str, Any]]:
        path = cls.get_session_file_path()
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception as e:
            sys.stderr.write(f"[SessionManager] Warning reading session file: {e}\n")
        return {}

    @classmethod
    def get_session(cls, host_or_url: str) -> dict[str, Any] | None:
        host = cls._normalize_host(host_or_url)
        if not host:
            return None

        sessions = cls.load_all_sessions()
        session = sessions.get(host)
        if not session:
            parts = host.split(".")
            if len(parts) > 2:
                parent_domain = ".".join(parts[-2:])
                session = sessions.get(parent_domain)

        if not session or not isinstance(session, dict):
            return None

        expires_at = session.get("expires_at", 0)
        if expires_at and time.time() > expires_at:
            cls.invalidate(host)
            return None

        cookies = session.get("cookies", {})
        if not cookies or not isinstance(cookies, dict):
            return None

        return session

    @classmethod
    def save_session(
        cls,
        host_or_url: str,
        cookies: list[dict[str, Any]] | dict[str, str],
        user_agent: str,
        ttl_seconds: int = 1800,
    ) -> None:
        host = cls._normalize_host(host_or_url)
        if not host:
            return

        cookie_dict: dict[str, str] = {}
        if isinstance(cookies, list):
            for c in cookies:
                name = c.get("name")
                val = c.get("value")
                if name and val is not None:
                    cookie_dict[name] = str(val)
        elif isinstance(cookies, dict):
            cookie_dict = {str(k): str(v) for k, v in cookies.items()}

        if not cookie_dict:
            return

        now = time.time()
        session_data = {
            "cookies": cookie_dict,
            "user_agent": user_agent,
            "created_at": now,
            "expires_at": now + ttl_seconds,
        }

        path = cls.get_session_file_path()
        all_sessions = cls.load_all_sessions()
        all_sessions[host] = session_data

        parts = host.split(".")
        if len(parts) > 2:
            apex = ".".join(parts[-2:])
            all_sessions[apex] = session_data

        cleaned = {
            h: s
            for h, s in all_sessions.items()
            if isinstance(s, dict) and s.get("expires_at", 0) > now
        }

        temp_path = f"{path}.tmp.{os.getpid()}"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(cleaned, f, indent=2)
            os.replace(temp_path, path)
            sys.stderr.write(f"[SessionManager] Saved session for {host} (TTL {ttl_seconds}s)\n")
        except Exception as e:
            sys.stderr.write(f"[SessionManager] Warning writing session file: {e}\n")
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    @classmethod
    def invalidate(cls, host_or_url: str) -> None:
        host = cls._normalize_host(host_or_url)
        if not host:
            return

        all_sessions = cls.load_all_sessions()
        changed = False
        if host in all_sessions:
            del all_sessions[host]
            changed = True

        parts = host.split(".")
        if len(parts) > 2:
            apex = ".".join(parts[-2:])
            if apex in all_sessions:
                del all_sessions[apex]
                changed = True

        if changed:
            path = cls.get_session_file_path()
            temp_path = f"{path}.tmp.{os.getpid()}"
            try:
                with open(temp_path, "w", encoding="utf-8") as f:
                    json.dump(all_sessions, f, indent=2)
                os.replace(temp_path, path)
                sys.stderr.write(f"[SessionManager] Invalidated session for {host}\n")
            except Exception:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass
