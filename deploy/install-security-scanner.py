#!/usr/bin/python3 -I
"""Install pinned Trivy as the API service user, using Go's verified module proxy."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
VERSION = "v0.76.2"
TOOLCHAIN = "go1.27.4"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=Path.home() / ".coreops-tools")
    parser.add_argument("--skip-db", action="store_true")
    args = parser.parse_args()
    destination = args.destination.absolute()
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.is_symlink() or destination.stat().st_uid != os.geteuid() or destination.stat().st_mode & 0o022:
        raise ValueError("Destination must be a private directory owned by the API user")
    go = shutil.which("go")
    if not go:
        raise RuntimeError("Go is required to build the authenticated module source")
    env = {"PATH": str(Path(go).parent) + ":/usr/local/bin:/usr/bin:/bin", "HOME": str(Path.home()), "GOTOOLCHAIN": TOOLCHAIN, "GOMAXPROCS": "4", "CGO_ENABLED": "0", "GOSUMDB": "sum.golang.org"}
    cache = Path.home() / ".cache" / "coreops-trivy"
    metadata = json.loads(subprocess.check_output([go, "mod", "download", "-json", "github.com/aquasecurity/trivy@" + VERSION], env=env, timeout=300))
    if metadata.get("Version") != VERSION or not metadata.get("Sum"):
        raise RuntimeError("Verified module metadata missing")
    with tempfile.TemporaryDirectory(prefix="coreops-trivy-build-", dir=destination) as work:
        source = Path(work) / "source"
        shutil.copytree(metadata["Dir"], source)
        binary = Path(work) / "trivy"
        subprocess.run([go, "build", "-p", "2", "-ldflags", "-s -w -X=github.com/aquasecurity/trivy/pkg/version/app.ver=" + VERSION.removeprefix("v"), "-o", str(binary), "./cmd/trivy"], cwd=source, env=env, timeout=1800, check=True)
        binary.chmod(0o755)
        binary.replace(destination / "trivy")
    if not args.skip_db:
        subprocess.run([str(destination / "trivy"), "image", "--download-db-only", "--cache-dir", str(cache), "--timeout", "4m"], env=env, timeout=300, check=True)
    print("COREOPS_TRIVY_PATH=" + str(destination / "trivy"))
    print("COREOPS_TRIVY_CACHE=" + str(cache))
    print("Installed " + VERSION + " from authenticated source " + metadata["Sum"] + ". No host package, firewall or container changed.")

if __name__ == "__main__":
    main()
