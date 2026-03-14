#!/usr/bin/env python3
"""
main.py — entry point.

Runs FastAPI backend (uvicorn on :8000) + Next.js frontend (npm run dev on :3000)
as two parallel subprocesses. No Vercel CLI needed.

Just run:  python main.py
""" 
import subprocess
import sys
import os
import signal
import threading

IS_WIN = sys.platform == "win32"

def _cmd(name: str) -> str:
    """Return the correct executable name for the current platform."""
    return name + ".cmd" if IS_WIN else name


def _stream(proc: subprocess.Popen, prefix: str) -> None:
    """Forward subprocess stdout/stderr to our console with a prefix."""
    for line in iter(proc.stdout.readline, b""):
        print(f"{prefix} {line.decode(errors='replace').rstrip()}", flush=True)


def main() -> None:
    root   = os.path.dirname(os.path.abspath(__file__))
    be_dir = os.path.join(root, "backend")
    fe_dir = os.path.join(root, "frontend")

    # ── 1. Install Python backend deps ────────────────────────────────────
    print("[launcher] Installing backend Python dependencies ...")
    pip = subprocess.run(
        [sys.executable, "-m", "pip", "install",
         "fastapi[standard]", "websockets", "pandas", "numpy",
         "--quiet", "--disable-pip-version-check"],
        check=False,
    )
    if pip.returncode != 0:
        print("[launcher] WARNING: pip install had errors — continuing anyway")

    # ── 2. Install Node frontend deps ─────────────────────────────────────
    if not os.path.isdir(os.path.join(fe_dir, "node_modules")):
        print("[launcher] Installing frontend Node.js dependencies (first run) ...")
        try:
            subprocess.run(
                [_cmd("npm"), "install"],
                cwd=fe_dir,
                check=True,
                shell=IS_WIN,
            )
        except FileNotFoundError:
            print(
                "\n[launcher] ERROR: 'npm' not found.\n"
                "Install Node.js from https://nodejs.org then re-run.\n"
            )
            sys.exit(1)

    print("\n[launcher] Starting services:")
    print("  backend  → http://localhost:8000")
    print("  frontend → http://localhost:3000\n")

    # ── 3. Start FastAPI with uvicorn ──────────────────────────────────────
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=be_dir,
        env={**os.environ, "PYTHONPATH": "."},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    # ── 4. Start Next.js dev server ────────────────────────────────────────
    frontend = subprocess.Popen(
        [_cmd("npm"), "run", "dev"],
        cwd=fe_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=IS_WIN,
    )

    # Stream output from both processes
    threading.Thread(target=_stream, args=(backend,  "[backend] "), daemon=True).start()
    threading.Thread(target=_stream, args=(frontend, "[frontend]"), daemon=True).start()

    # ── 5. Wait — kill both on Ctrl+C ─────────────────────────────────────
    def _shutdown(sig, frame):
        print("\n[launcher] Shutting down ...")
        backend.terminate()
        frontend.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    backend.wait()
    frontend.wait()


if __name__ == "__main__":
    main()
