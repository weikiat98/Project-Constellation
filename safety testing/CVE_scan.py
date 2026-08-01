# Cheap CVE Scanning/ EOS/ EOL monitoring

## Step 1: CVE Scanning for Python (requirements.txt)
# pip install pip-audit
# pip-audit -r requirements.txt

# Step 2: CVE Scanning for React/Node.js (package.json)
# npm audit --json > audit-node.json
# yarn audit --json > audit-node.json (only if using yarn)

# Step 3: Unified CVE Scanning (Both Ecosystems Together)
# go install http://github.com/google/osv-scanner/cmd/osv-scanner@latest 
# osv-scanner --lockfile requirements.txt --lockfile package-lock.json

# Step 4: EOL/EOS Tracking for Runtimes
# curl https://endoflife.date/api/python/3.11.json (auto-detected from the running interpreter)
# curl https://endoflife.date/api/nodejs/24.json (auto-detected from `node --version` / package.json engines.node)

# Step 5: Deprecation Notices (all packages in the repo, checked in one run)
# pip index versions <package>  -> flags yanked releases on PyPI
# npm show <package> deprecated -> prints the registry's deprecation message, if any
# Both checks below auto-discover every package from requirements.txt / package.json
# and loop over them, so a single script run covers the whole repo.

import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS_FILE = REPO_ROOT / "requirements.txt"
PACKAGE_JSON_FILE = REPO_ROOT / "frontend" / "package.json"


def detect_python_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def detect_node_version(package_json_path: Path) -> str | None:
    if package_json_path.exists():
        try:
            data = json.loads(package_json_path.read_text())
            engines_node = data.get("engines", {}).get("node")
            if engines_node:
                match = re.search(r"(\d+)", engines_node)
                if match:
                    return match.group(1)
        except (json.JSONDecodeError, OSError):
            pass
    node_path = shutil.which("node")
    if node_path:
        try:
            result = subprocess.run(
                [node_path, "--version"], capture_output=True, text=True, timeout=10,
            )
            match = re.search(r"(\d+)", result.stdout)
            if match:
                return match.group(1)
        except (subprocess.TimeoutExpired, OSError):
            pass
    return None


checks = [("python", detect_python_version())]
node_version = detect_node_version(PACKAGE_JSON_FILE)
if node_version:
    checks.append(("nodejs", node_version))
else:
    print("Could not auto-detect Node.js version (node not on PATH, no engines.node in package.json); skipping nodejs EOL check")

today = date.today()

for product, version in checks:
    url = f"https://endoflife.date/api/{product}/{version}.json"
    resp = requests.get(url)
    if resp.status_code == 200:
        data = resp.json()
        eol_date = data.get("eol")
        print(f"{product} {version}: EOL = {eol_date}")
        if eol_date and date.fromisoformat(eol_date) < today:
            print(f"  ⚠️  WARNING: {product} {version} is past EOL!")
    else:
        print(f"Could not fetch data for {product} {version}")


def parse_pip_packages(requirements_path: Path) -> list[str]:
    if not requirements_path.exists():
        return []
    names = []
    for line in requirements_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_.\-]+)", line)
        if match:
            names.append(match.group(1))
    return names


def parse_npm_packages(package_json_path: Path) -> list[str]:
    if not package_json_path.exists():
        return []
    data = json.loads(package_json_path.read_text())
    names = list(data.get("dependencies", {}).keys())
    names += list(data.get("devDependencies", {}).keys())
    return names


def check_pip_deprecations(packages: list[str]) -> None:
    print("\n--- Pip deprecation check (pip index versions) ---")
    for pkg in packages:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "index", "versions", pkg],
                capture_output=True, text=True, timeout=30,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            print(f"  {pkg}: could not check ({exc})")
            continue
        output = result.stdout + result.stderr
        if "yanked" in output.lower():
            print(f"  ⚠️  {pkg}: one or more versions are YANKED on PyPI")
            for line in output.splitlines():
                if "yanked" in line.lower():
                    print(f"      {line.strip()}")
        elif result.returncode != 0:
            print(f"  {pkg}: could not resolve on PyPI (possibly removed/renamed)")


def check_npm_deprecations(packages: list[str]) -> None:
    print("\n--- npm deprecation check (npm show <package> deprecated) ---")
    npm_path = shutil.which("npm")
    if not npm_path:
        print("  npm not found on PATH; skipping")
        return
    for pkg in packages:
        try:
            result = subprocess.run(
                [npm_path, "show", pkg, "deprecated"],
                capture_output=True, text=True, timeout=30,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            print(f"  {pkg}: could not check ({exc})")
            continue
        message = result.stdout.strip()
        if message:
            print(f"  ⚠️  {pkg}: DEPRECATED — {message}")


check_pip_deprecations(parse_pip_packages(REQUIREMENTS_FILE))
check_npm_deprecations(parse_npm_packages(PACKAGE_JSON_FILE))