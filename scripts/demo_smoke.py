"""
Cheap pre-demo smoke test for OpsOrchestrator.

Run the server first:
    python server.py
Then:
    python scripts/demo_smoke.py
"""

from __future__ import annotations

import json
from urllib.error import URLError
from urllib.request import urlopen


BASE_URL = "http://127.0.0.1:8010"
EXPECTED = {
    "01_it_access_request",
    "02_finance_vendor_exception",
    "03_hr_certificate_missing_info",
    "04_legal_contract_review",
}


def get_json(path: str) -> dict | list:
    with urlopen(BASE_URL + path, timeout=5) as res:  # noqa: S310 - local demo URL
        return json.loads(res.read().decode("utf-8"))


def get_text(path: str) -> str:
    with urlopen(BASE_URL + path, timeout=5) as res:  # noqa: S310 - local demo URL
        return res.read().decode("utf-8", errors="replace")


def main() -> int:
    try:
        health = get_json("/api/health")
        examples = set(get_json("/api/examples"))
        html = get_text("/")
    except URLError as exc:
        print(f"ERROR server not reachable: {exc}")
        return 1

    checks = {
        "home_page": "OpsOrchestrator" in html,
        "openai_key_configured": bool(health.get("openai_key")),
        "examples_present": EXPECTED <= examples,
    }
    for key, ok in checks.items():
        print(f"{'OK' if ok else 'FAIL'} {key}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
