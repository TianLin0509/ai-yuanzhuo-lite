# -*- coding: utf-8 -*-
"""Upload one release's update assets to the backup server and check them from the public address.

Backup server: the Caddy static site me.lt-stockpartner.tech/pptutor/ <-> C:/pptutor-updates (shared with PPT Doctor).
This product lives in its own folder yuanzhuo-lite/. Order: bundle -> signature -> manifest last, so a client never
sees a manifest that points at a file not yet uploaded. Usage (needs ECS_PWD):
    uv run --with paramiko python scripts/mirror_update.py <release dir> <bundle file name>
"""
import base64, hashlib, os, sys, time, urllib.request
from pathlib import Path
import paramiko

HOST, USER = "8.130.158.231", "Administrator"
REMOTE = "C:/pptutor-updates/yuanzhuo-lite"
PUBLIC = "https://me.lt-stockpartner.tech/pptutor/yuanzhuo-lite"
# Pinned host key (read 2026-10-15): a server that presents another key never receives the password.
HOST_KEY = paramiko.Ed25519Key(data=base64.b64decode("AAAAC3NzaC1lZDI1NTE5AAAAIOmuQya3HFIUb1vZ5aMmnsBWB0VrGjMN+HEBu8GA5OR+"))

def main():
    out, bundle = Path(sys.argv[1]), sys.argv[2]
    names = sorted(n.name for n in out.glob("ai-yuanzhuo-lite-v*.zip")) + [bundle, "update-manifest.sig", "update-manifest.json"]
    client = paramiko.SSHClient(); client.get_host_keys().add(HOST, "ssh-ed25519", HOST_KEY); client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST, username=USER, password=os.environ["ECS_PWD"], timeout=30)
    try:
        sftp = client.open_sftp()
        try: sftp.mkdir(REMOTE)
        except IOError: pass
        for name in names:
            tmp = f"{REMOTE}/{name}.uploading"
            sftp.put(str(out / name), tmp)
            try: sftp.remove(f"{REMOTE}/{name}")
            except IOError: pass
            sftp.rename(tmp, f"{REMOTE}/{name}")
            print("uploaded", name)
    finally:
        client.close()
    bad = 0
    for name in names:
        want = hashlib.sha256((out / name).read_bytes()).hexdigest()
        url = f"{PUBLIC}/{name}?t={int(time.time())}"
        got = hashlib.sha256(urllib.request.urlopen(url, timeout=60).read()).hexdigest()
        print("verified" if got == want else "MISMATCH", url)
        bad += got != want
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
