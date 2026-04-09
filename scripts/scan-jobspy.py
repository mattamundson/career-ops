#!/usr/bin/env python3
"""
scan-jobspy.py — Multi-board job scraper using python-jobspy
Scrapes LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google Jobs for remote data/AI roles.

Usage:
  python scripts/scan-jobspy.py              — run live scan, write to pipeline.md
  python scripts/scan-jobspy.py --dry-run    — print results without writing files
  python scripts/scan-jobspy.py --boards=X,Y — comma-separated board list override
  python scripts/scan-jobspy.py --term="X"   — single search term override
  python scripts/scan-jobspy.py --results=N  — results per search term (default: 25)

Boards available: linkedin, indeed, glassdoor, zip_recruiter, google
"""

import sys
import os
import csv
import re
import subprocess
from pathlib import Path
from datetime import date

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT        = Path(__file__).resolve().parent.parent
HISTORY_TSV = ROOT / "data" / "scan-history.tsv"
PIPELINE_MD = ROOT / "data" / "pipeline.md"
SCRIPTS_DIR = ROOT / "scripts"

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------
args = sys.argv[1:]
DRY_RUN      = "--dry-run" in args
BOARDS_FLAG  = next((a.split("=", 1)[1] for a in args if a.startswith("--boards=")),  None)
TERM_FLAG    = next((a.split("=", 1)[1] for a in args if a.startswith("--term=")),    None)
RESULTS_FLAG = next((a.split("=", 1)[1] for a in args if a.startswith("--results=")), None)

# ---------------------------------------------------------------------------
# Config: search terms, boards, title filters
# Mirrors portals.yml title_filter.positive / negative
# ---------------------------------------------------------------------------
SEARCH_TERMS = [TERM_FLAG] if TERM_FLAG else [
    "data architect remote",
    "analytics engineer remote",
    "power bi architect",
    "power bi developer remote",
    "business intelligence architect remote",
    "microsoft fabric architect",
    "ai automation engineer remote",
    "solutions architect data remote",
    "senior bi developer remote",
]

BOARDS = BOARDS_FLAG.split(",") if BOARDS_FLAG else [
    "linkedin",
    "indeed",
    "glassdoor",
    "zip_recruiter",
    "google",
]

RESULTS_WANTED = int(RESULTS_FLAG) if RESULTS_FLAG else 25

POSITIVE_KW = [
    "data architect", "data engineer", "analytics engineer", "bi engineer",
    "bi architect", "bi developer", "business intelligence", "power bi",
    "power bi developer", "power bi architect", "microsoft fabric", "fabric architect",
    "fabric engineer", "ai automation", "automation engineer", "workflow automation",
    "solutions architect", "data platform", "data warehouse", "data warehouse architect",
    "analytics architect", "analytics platform", "analytics lead", "data lead",
    "analytics manager", "data manager", "data governance", "data strategy",
    "applied ai", "ai engineer", "ml engineer", "information architect",
]

NEGATIVE_KW = [
    "junior", "intern", "entry level", "associate", "coordinator",
    "administrative", "marketing analyst", "financial analyst", "accountant",
    "qa automation", "test automation", "devops", "network engineer",
    "network architect", "security architect", "infrastructure architect",
]

# International location keywords — skip these roles
INTL_KW = [
    "germany", "german", "france", "french", " uk ", "london", "emea",
    "canada", "toronto", "ontario", "montreal", "vancouver",
    "seoul", "south korea", "korea", "tokyo", "japan",
    "india", "ahmedabad", "gurugram", "bengaluru", "mumbai",
    "singapore", "apac", "australia", "sydney", "melbourne", "new zealand",
    "argentina", "brazil", "latam", "latin america",
    "netherlands", "amsterdam", "poland", "barcelona", "madrid",
    "dublin", "ireland", "frankfurt", "sweden", "denmark", "copenhagen",
    "norway", "oslo", "finland", "helsinki", "switzerland", "zurich",
]

# ---------------------------------------------------------------------------
# Title + location filters
# ---------------------------------------------------------------------------
def title_passes(title: str) -> bool:
    t = title.lower()
    if not any(kw in t for kw in POSITIVE_KW):
        return False
    if any(kw in t for kw in NEGATIVE_KW):
        return False
    return True

def is_international(title: str, location: str) -> bool:
    combined = (title + " " + (location or "")).lower()
    return any(kw in combined for kw in INTL_KW)

# ---------------------------------------------------------------------------
# Load existing URLs from scan-history.tsv + pipeline.md for deduplication
# ---------------------------------------------------------------------------
def load_seen_urls() -> set:
    seen = set()
    if HISTORY_TSV.exists():
        with open(HISTORY_TSV, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                if row.get("url"):
                    seen.add(row["url"].strip())
    if PIPELINE_MD.exists():
        for line in PIPELINE_MD.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.search(r'https?://[^\s|]+', line)
            if m:
                seen.add(m.group(0).strip())
    return seen

# ---------------------------------------------------------------------------
# Append entries to pipeline.md (format: - [ ] URL | Company | Title)
# ---------------------------------------------------------------------------
def append_to_pipeline(entries: list):
    if not PIPELINE_MD.exists():
        PIPELINE_MD.write_text(
            "# Job Pipeline — URL Inbox\n\n## Pending\n\n## Processed\n",
            encoding="utf-8"
        )
    text = PIPELINE_MD.read_text(encoding="utf-8")
    marker = "## Pending"
    idx = text.find(marker)
    if idx == -1:
        text += f"\n{marker}\n"
        idx = text.rfind(marker)

    lines = [f"- [ ] {e['url']} | {e['company']} | {e['title']}" for e in entries]
    insert_after = idx + len(marker)
    text = text[:insert_after] + "\n" + "\n".join(lines) + "\n" + text[insert_after:]
    PIPELINE_MD.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Append to scan-history.tsv
# ---------------------------------------------------------------------------
def append_to_history(entries: list):
    today = date.today().isoformat()
    write_header = not HISTORY_TSV.exists()
    with open(HISTORY_TSV, "a", newline="", encoding="utf-8") as f:
        if write_header:
            f.write("url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n")
        for e in entries:
            safe_title   = e["title"].replace("\t", " ")
            safe_company = e["company"].replace("\t", " ")
            f.write(f"{e['url']}\t{today}\tjobspy/{e['site']}\t{safe_title}\t{safe_company}\tnew\n")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    try:
        from jobspy import scrape_jobs
    except ImportError:
        print(
            "[ERROR] python-jobspy not installed.\n"
            "Run: python -m pip install --user git+https://github.com/speedyapply/JobSpy.git"
        )
        sys.exit(1)

    seen_urls = load_seen_urls()

    print(f"\nJobSpy Scan — {date.today().isoformat()}")
    print("━" * 50)
    print(f"  Boards:       {', '.join(BOARDS)}")
    print(f"  Search terms: {len(SEARCH_TERMS)}")
    print(f"  Results/term: {RESULTS_WANTED}")
    print(f"  Already seen: {len(seen_urls)} URLs")
    print(f"  Mode:         {'DRY Run' if DRY_RUN else 'LIVE'}")
    print()

    all_new = []

    for term in SEARCH_TERMS:
        print(f"  Searching: {term!r}...")
        try:
            df = scrape_jobs(
                site_name=BOARDS,
                search_term=term,
                location="United States",
                results_wanted=RESULTS_WANTED,
                country_indeed="USA",
                is_remote=True,
                description_format="markdown",
            )
        except Exception as exc:
            print(f"    [ERROR] {exc}")
            continue

        if df is None or len(df) == 0:
            print("    No results returned.")
            continue

        matched = 0
        new_for_term = 0

        for _, row in df.iterrows():
            title    = str(row.get("title",    "") or "").strip()
            company  = str(row.get("company",  "") or "").strip()
            url      = str(row.get("job_url",  "") or "").strip()
            site     = str(row.get("site",     "") or "").strip()
            location = str(row.get("location", "") or "").strip()

            # Skip empty or pandas NaN values
            if not url or url == "nan" or not title or title == "nan":
                continue

            if not title_passes(title):
                continue

            if is_international(title, location):
                continue

            matched += 1

            if url in seen_urls:
                continue

            seen_urls.add(url)  # prevent intra-run duplicates
            new_for_term += 1

            safe_company = company if company and company != "nan" else "Unknown"
            all_new.append({
                "url":      url,
                "title":    title,
                "company":  safe_company,
                "site":     site,
                "location": location,
            })
            print(f"    + [{site:<12}] {safe_company} | {title}")

        print(f"    → {len(df)} total, {matched} title-matched, {new_for_term} new")

    print()
    print("━" * 50)
    print(f"  Total new: {len(all_new)}")
    print()

    if not all_new:
        print("No new jobs to add. Pipeline unchanged.")
        return

    if DRY_RUN:
        print("[DRY RUN] No files written.")
        return

    append_to_pipeline(all_new)
    append_to_history(all_new)
    print(f"Written {len(all_new)} entries → pipeline.md + scan-history.tsv")

    # Trigger prefilter card generation for newly-added entries
    print("Generating prefilter cards...")
    try:
        result = subprocess.run(
            ["node", str(SCRIPTS_DIR / "prefilter-pipeline.mjs")],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"[WARN] prefilter-pipeline.mjs exited {result.returncode}: {result.stderr.strip()}")
        else:
            # Print just the last few lines (summary)
            for line in result.stdout.strip().splitlines()[-6:]:
                print(f"  {line}")
    except FileNotFoundError:
        print("[WARN] node not found — run manually: node scripts/prefilter-pipeline.mjs")

    print()
    print(f"→ Run: node scripts/prefilter-pipeline.mjs --list   to see updated scores")
    print()


if __name__ == "__main__":
    main()
