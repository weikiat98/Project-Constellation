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
# curl https://endoflife.date/api/python/3.11.json (change python version as needed)
# curl https://endoflife.date/api/nodejs/24.json (change node version as needed)

import requests
from datetime import date
checks = [
    ("python", "3.11"),
    ("nodejs", "24"),
]

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