#!/usr/bin/env python3
"""OverTaxed production route + copy smoke.

Usage:
  python scripts/overtaxed_live_smoke.py https://www.overtaxed-il.com

Route status failures are hard failures. Copy checks hard-fail only on positive
marketing claims or stale live-count phrasing; negative disclaimers such as
"we do not guarantee a reduction" are explicitly allowed.
"""
from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from html import unescape

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://www.overtaxed-il.com"
ROUTES = ["/", "/hoa", "/pricing", "/deadlines", "/faq", "/appeal-packet", "/appeal-contingency"]
UA = "RexOverTaxedLiveSmoke/1.1"

NEGATIVE_GUARANTEE_DISCLAIMER = re.compile(
    r"\b(?:do(?:es)?\s+not|no|not)\s+guarantee(?:d)?\b|\bno\s+reduction\s+is\s+guaranteed\b",
    re.I,
)

HARD_COPY_PATTERNS = {
    "alexy_full_name": re.compile(r"Alexy\s+Kaplun", re.I),
    "updated_weekly": re.compile(r"Updated\s+Weekly", re.I),
    "money_back_guarantee": re.compile(
        r"money[- ]back\s+guarantee|procedural\s+money[- ]back\s+guarantee",
        re.I,
    ),
    "guaranteed_savings": re.compile(r"guaranteed\s+(?:savings|reduction|result|outcome)", re.I),
    "risk_free": re.compile(r"risk[- ]free", re.I),
    "stale_township_count_marketing": re.compile(
        r"all\s+38\s+townships|see\s+all\s+38\s+townships|\b38\s+townships\b",
        re.I,
    ),
    "fake_live_ticker": re.compile(r"township\s+ticker|live\s+township", re.I),
}


def html_to_text(body: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", body))).strip()


def fetch(path: str) -> tuple[int | None, str]:
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.getcode(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - diagnostic script
        return None, f"FETCH_ERROR: {e!r}"


def snippets(text: str, pattern: re.Pattern[str], limit: int = 5) -> list[str]:
    out: list[str] = []
    for match in pattern.finditer(text):
        start = max(0, match.start() - 90)
        end = min(len(text), match.end() + 90)
        out.append(text[start:end].strip())
        if len(out) >= limit:
            break
    return out


def strip_allowed_negative_guarantee_disclaimers(text: str) -> str:
    return NEGATIVE_GUARANTEE_DISCLAIMER.sub("", text)


def main() -> int:
    hard_fail = False
    texts: dict[str, str] = {}

    print(f"BASE {BASE}")
    for path in ROUTES:
        code, body = fetch(path)
        print(f"ROUTE {path} HTTP {code} bytes={len(body)}")
        if code != 200:
            hard_fail = True
        texts[path] = html_to_text(body)

    combined = "\n".join(texts.values())
    for required in ["support@overtaxed-il.com", "(847) 461-3189"]:
        ok = required in combined
        print(f"REQUIRED {required}: {'PASS' if ok else 'FAIL'}")
        hard_fail = hard_fail or not ok

    for path, text in texts.items():
        claim_text = strip_allowed_negative_guarantee_disclaimers(text)
        for label, pat in HARD_COPY_PATTERNS.items():
            hits = snippets(claim_text, pat)
            if hits:
                hard_fail = True
                print(f"HARD_COPY {path} {label}")
                for hit in hits:
                    print(f"  {hit}")

    if hard_fail:
        print("SMOKE_FAIL")
        return 2
    print("SMOKE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
