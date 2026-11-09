#!/usr/bin/env python3
"""Apply a list of second-brain write operations through the vault's own CLI.

Usage: beyin_yaz.py OPS_JSON [--vault PATH]

Each op is one of:
  {"create": "<knowledge|notes path>", "text": "...", "metadata": {...}}   -> beyin.py note-create
  {"new": "<path>", "content": "..."}                                       -> note-edit, expected_sha256 null
  {"edit": "<path>", "edits": [{"old": "...", "new": "..."}]}               -> note-read (sha) + note-edit

Stops at the first failure (exit 1) so a partial plan is visible; ends with `sync`.
Never writes vault files directly: the CLI owns locking, backups and indexing.
"""
import json
import os
import subprocess
import sys
import tempfile


def run(vault, args, stdin=None):
    cmd = [sys.executable, os.path.join(vault, "beyin.py"), "--vault", vault, *args]
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True)


def status_of(p):
    try:
        return json.loads(p.stdout).get("status", "?")
    except (ValueError, AttributeError):
        return "?"


def main():
    argv = sys.argv[1:]
    vault = os.path.expanduser("~/IkinciBeyin")
    if "--vault" in argv:
        i = argv.index("--vault")
        vault = os.path.expanduser(argv[i + 1])
        del argv[i : i + 2]
    if len(argv) != 1:
        print(__doc__)
        return 2
    with open(argv[0], encoding="utf-8") as f:
        ops = json.load(f)
    if isinstance(ops, dict):
        ops = [ops]

    for n, op in enumerate(ops, 1):
        if "create" in op:
            src = op["create"]
            req = {"source": src, "text": op["text"], "metadata": op.get("metadata", {})}
            # note-create only documents a file path (no stdin), so use a private temp file.
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
                json.dump(req, tf, ensure_ascii=False)
            try:
                p = run(vault, ["note-create", "--file", tf.name])
            finally:
                os.unlink(tf.name)
            ok = p.returncode == 0 and status_of(p) == "succeeded"
        elif "new" in op:
            src = op["new"]
            os.makedirs(os.path.dirname(os.path.join(vault, src)) or vault, exist_ok=True)
            req = {"source": src, "expected_sha256": None, "content": op["content"]}
            p = run(vault, ["note-edit", "--file", "-"], json.dumps(req, ensure_ascii=False))
            ok = p.returncode == 0 and status_of(p) in ("written", "unchanged")
        elif "edit" in op:
            src = op["edit"]
            r = run(vault, ["note-read", src])
            if r.returncode != 0:
                print(f"[{n}] note-read başarısız: {src}\n{r.stdout}{r.stderr}")
                return 1
            sha = json.loads(r.stdout)["sha256"]
            req = {"source": src, "expected_sha256": sha, "edits": op["edits"]}
            p = run(vault, ["note-edit", "--file", "-"], json.dumps(req, ensure_ascii=False))
            ok = p.returncode == 0 and status_of(p) in ("written", "unchanged")
        else:
            print(f"[{n}] bilinmeyen işlem: {list(op)}")
            return 1
        print(f"[{n}] {src}: {status_of(p)}")
        if not ok:
            print(p.stdout + p.stderr)
            return 1

    s = run(vault, ["sync"])
    print(f"sync: {'ok' if s.returncode == 0 else 'HATA'}")
    if s.returncode != 0:
        print(s.stdout + s.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
