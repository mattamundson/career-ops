import re, json

# Title filter keywords
POSITIVE = [
    "data architect", "data engineer", "analytics engineer", "bi engineer",
    "business intelligence", "power bi", "ai automation", "automation engineer",
    "workflow automation", "solutions architect", "data platform", "analytics lead",
    "data lead", "analytics manager", "data manager", "erp analyst",
    "business systems", "operations analytics", "applied ai", "ai engineer",
    "ml engineer"
]

NEGATIVE = [
    "junior", "intern", "entry level", "coordinator",
    "administrative", "marketing analyst", "financial analyst", "accountant"
]

SENIORITY = ["senior", "lead", "principal", "staff", "director", "head of", "manager"]

def matches_positive(title):
    tl = title.lower()
    for kw in POSITIVE:
        if kw in tl:
            return True
    return False

def matches_negative(title):
    tl = title.lower()
    for kw in NEGATIVE:
        if kw == "intern":
            if re.search(r'\bintern\b', tl) or re.search(r'\binternship\b', tl):
                return True
        else:
            if kw in tl:
                return True
    return False

def has_seniority(title):
    tl = title.lower()
    for s in SENIORITY:
        if s in tl:
            return True
    return False

# All candidates: (title, company, url, source)
all_candidates = [
    # Query 1: Ashby data architect
    ("Data Architect - AI Trainer", "10x Team", "https://jobs.ashbyhq.com/10xteam/c5c8424b-81a3-4a36-be86-5f12b0cc5ea3", "ashby-data-architect"),
    ("Data Architect - AI Trainer", "10x Team", "https://jobs.ashbyhq.com/10xteam/65d35ae0-276b-4b64-9770-293919c160f7", "ashby-data-architect"),
    ("Data Architect (Trading)", "Keyrock", "https://jobs.ashbyhq.com/keyrock/eb257bc1-9a8e-4962-99ba-96c28946809d", "ashby-data-architect"),
    ("Data Architect, Robotics", "Mind Robotics", "https://jobs.ashbyhq.com/mindrobotics/105d9f55-9914-49a3-a622-1565dcde5f01", "ashby-data-architect"),
    # Query 2: Ashby analytics engineer
    ("Senior Data Analytics Engineer (Remote)", "Optro", "https://jobs.ashbyhq.com/optro/36117f50-ce81-481b-b9ce-9306c1472a7b", "ashby-analytics-engineer"),
    ("Staff Analytics Engineer (Remote)", "Rula", "https://jobs.ashbyhq.com/rula/fa784750-2c99-40e2-9fa6-0a54d47ac3da", "ashby-analytics-engineer"),
    ("Sr. Analytics Engineer (Remote)", "Rula", "https://jobs.ashbyhq.com/rula/4d29522a-520e-4609-aa79-3d69ecf6d01b", "ashby-analytics-engineer"),
    ("Senior Data Analytics Engineer (Remote, US)", "The Zebra", "https://jobs.ashbyhq.com/The%20Zebra/bdb61355-db92-4205-8da2-9c46745145cf", "ashby-analytics-engineer"),
    ("Senior Analytics Engineer (Remote)", "PermitFlow", "https://jobs.ashbyhq.com/permitflow/87dd965b-b610-4b45-9f84-6c4fc56f07cf", "ashby-analytics-engineer"),
    ("Senior Analytics Engineer", "Ramp", "https://jobs.ashbyhq.com/ramp/9c8eb907-e0f3-4241-8e00-793b8a0acbf6", "ashby-analytics-engineer"),
    ("Analytics Engineer", "AirGarage", "https://jobs.ashbyhq.com/airgarage/86a808c8-86c5-4f28-927a-232a93bdc991", "ashby-analytics-engineer"),
    ("Staff Analytics Engineer", "tem", "https://jobs.ashbyhq.com/tem/66b06873-4d08-4347-9d16-dc5c24ae481c", "ashby-analytics-engineer"),
    ("Analytics Engineer", "Sweed", "https://jobs.ashbyhq.com/sweedpos.com/dd252dc4-947a-41c1-b92b-a76c03028965", "ashby-analytics-engineer"),
    # Query 3: Ashby ai/workflow automation
    ("AI Automation Expert", "Zapier", "https://jobs.ashbyhq.com/zapier/cac70300-4e62-4299-bc34-aab69e7498f4", "ashby-ai-automation"),
    ("AI Automation Engineer (Remote)", "Quora", "https://jobs.ashbyhq.com/quora/b0ef4655-20b0-4c4f-93d2-037556c6c9e5", "ashby-ai-automation"),
    ("Workflow Automation Engineer", "n8n", "https://jobs.ashbyhq.com/n8n/b1cac773-bbcd-4aad-bea8-1c858729c9ef", "ashby-ai-automation"),
    ("Workflow Automation Engineer", "hyperexponential", "https://jobs.ashbyhq.com/hyperexponential/7f7073b0-1bd9-4e63-b359-26350e6281e3", "ashby-ai-automation"),
    ("AI Automation Engineer", "Pragmatico", "https://jobs.ashbyhq.com/pragmatico/6b1dab42-2cc4-4273-b92a-eea0a993b2a2", "ashby-ai-automation"),
    # Query 4: Greenhouse data architect
    ("Principal Data Architect (Remote)", "ezCater", "https://boards.greenhouse.io/ezcaterinc/jobs/4017497007", "greenhouse-data-architect"),
    ("Senior Data Engineer, Solutions Architect - US Remote", "Degreed", "https://boards.greenhouse.io/degreed/jobs/4623924004", "greenhouse-data-architect"),
    ("Enterprise Data Solutions Architect - US West (Remote)", "Workato", "https://boards.greenhouse.io/workato/jobs/4991300002", "greenhouse-data-architect"),
    ("Enterprise Data Solutions Architect - US East (Remote)", "Workato", "https://boards.greenhouse.io/workato/jobs/4991291002", "greenhouse-data-architect"),
    ("Data Architect, AWS, Contract", "66degrees", "https://boards.greenhouse.io/66degrees/jobs/5339276004", "greenhouse-data-architect"),
    ("Data Architect, Oracle/GCP, Contract", "66degrees", "https://boards.greenhouse.io/66degrees/jobs/5339312004", "greenhouse-data-architect"),
    ("Enterprise Data Solutions Architect - US Market (Remote)", "Workato", "https://boards.greenhouse.io/workato/jobs/4991282002", "greenhouse-data-architect"),
    ("Data Architect", "Equal Experts", "https://boards.greenhouse.io/equalexperts/jobs/5430945002", "greenhouse-data-architect"),
    ("Lead Data Architect", "Energage", "https://boards.greenhouse.io/energage/jobs/7799655002", "greenhouse-data-architect"),
    ("Data Architect", "Breeze Airways", "https://boards.greenhouse.io/breezeairways/jobs/5681458003", "greenhouse-data-architect"),
    # Query 5: Greenhouse BI engineer
    ("Business Intelligence Engineer (Remote)", "Telnyx", "https://boards.greenhouse.io/telnyx54/jobs/6390072003", "greenhouse-bi-engineer"),
    ("Business Intelligence Engineer", "Kasa Living", "https://boards.greenhouse.io/kasaliving/jobs/4950910003", "greenhouse-bi-engineer"),
    ("Business Intelligence Engineer", "Green Thumb", "https://boards.greenhouse.io/greenthumbindustries/jobs/3339269", "greenhouse-bi-engineer"),
    ("Senior Business Intelligence Engineer - Monitoring", "MNTN", "https://boards.greenhouse.io/mntn/jobs/3690614", "greenhouse-bi-engineer"),
    # Query 6: Lever data platform/architect
    ("Big Data Architect (Remote)", "Smart Working Solutions", "https://jobs.lever.co/smart-working-solutions/44bdb512-aeb3-445c-90ff-963d1742345a", "lever-data-architect"),
    ("Lead Platform & Data Architect - REMOTE", "Jobgether", "https://jobs.lever.co/jobgether/05a9c49a-cabb-43b4-8fe6-4515b763fd26", "lever-data-architect"),
    ("Senior Cloud Data Architect - REMOTE", "Jobgether", "https://jobs.lever.co/jobgether/54e05a2f-3440-4f93-8152-2feb5cbaf2f0", "lever-data-architect"),
    ("Remote Data Architect", "Jobgether", "https://jobs.lever.co/jobgether/966ab0ce-64cb-4a43-bb9d-bff13e0a6130", "lever-data-architect"),
    ("Data Platform Architect - REMOTE", "Jobgether", "https://jobs.lever.co/jobgether/7b329dab-4c23-47a0-a6af-0b5a47c85e8d", "lever-data-architect"),
    ("Sr. Data Architect (Remote)", "Jobgether", "https://jobs.lever.co/jobgether/90561a6f-2d7c-43d7-893f-d04df65b4bba", "lever-data-architect"),
    ("Data Architect - Remote", "AHEAD", "https://jobs.lever.co/thinkahead/43b18313-b84f-42fc-ac4f-907db8e5b85c", "lever-data-architect"),
    ("Lead Data Architect - remote", "Jobgether", "https://jobs.lever.co/jobgether/d37709e8-e219-4dfa-8bdc-b80ca1845396", "lever-data-architect"),
    ("Senior Data Architect - REMOTE", "Jobgether", "https://jobs.lever.co/jobgether/f3ff1646-741a-46cf-84c6-415de63960e7", "lever-data-architect"),
    ("Cloud Data Architect (Remote from US)", "Jobgether", "https://jobs.lever.co/jobgether/4de9719b-ce49-4340-a3f0-1de890261ebc", "lever-data-architect"),
    # Query 7: Lever analytics lead/engineer
    ("Senior Analytics Engineer", "Tala", "https://jobs.lever.co/tala/a7877846-bd81-4da8-a304-3720312b1da8", "lever-analytics-engineer"),
    ("Senior Analytics Engineer", "Super.com", "https://jobs.lever.co/super-com/f303a862-5e3e-42b4-95e9-9c7c2a07d0c7", "lever-analytics-engineer"),
    ("Lead Analytics Engineer", "HighLevel", "https://jobs.lever.co/gohighlevel/710ec13c-7d13-4872-a3f8-5f3f9654bfb0", "lever-analytics-engineer"),
    ("Senior Analytics Engineer", "Pano AI", "https://jobs.lever.co/pano/b2fc2091-5742-418d-9d90-88f7b911fd8c", "lever-analytics-engineer"),
    ("Sr. Analytics Engineer - Remote", "Jobgether", "https://jobs.lever.co/jobgether/f5f6de77-5b7f-449a-936c-446ba95ccf94", "lever-analytics-engineer"),
    ("Senior Analytics Engineer", "Sword Health", "https://jobs.lever.co/swordhealth/9d229a43-40ad-4311-b16f-5574a6ae17c6", "lever-analytics-engineer"),
    # Query 9: Wellfound ai automation (Quora dupe will be caught)
    ("AI Automation Engineer (Remote)", "Quora (Wellfound)", "https://wellfound.com/jobs/3314382-ai-automation-engineer-remote", "wellfound-ai-automation"),
    # Query 10: Workable data/bi architect
    ("Remote GCP Data Architect", "tekHouse", "https://apply.workable.com/tekhouse/j/394E022828/", "workable-data-architect"),
    ("Senior Data Architect", "Irth Solutions", "https://apply.workable.com/irth-solutions/j/36836F56A3", "workable-data-architect"),
    ("Data Architect", "Norgine", "https://apply.workable.com/norgine-2/j/DC41214B66", "workable-data-architect"),
    ("Data Architect", "Qode", "https://apply.workable.com/qodeworld/j/F6DE275E41", "workable-data-architect"),
    ("Senior Full-Stack BI Architect / Fabric Data Engineer", "Proactive Technology Mgmt", "https://apply.workable.com/proactive-technology-management/j/37EAFAD822/", "workable-data-architect"),
    ("Big Data Architect", "Cognite", "https://apply.workable.com/cognite/j/9F6D96623A/", "workable-data-architect"),
    ("Senior Data Engineer - AI-Accelerated Data Architecture", "Whiteshield", "https://apply.workable.com/whiteshield/j/B1C32A8FEF/", "workable-data-architect"),
    ("Data Architect", "Zone IT Solutions", "https://apply.workable.com/zoneit/j/9C3919FA6E/", "workable-data-architect"),
    ("Senior Data Architect", "Tactiq", "https://apply.workable.com/tactiq/j/0E6B5E8202", "workable-data-architect"),
    ("Data Architect", "Unlimited Technology Inc.", "https://apply.workable.com/unlimited-technology-inc/j/5592F2EBC0", "workable-data-architect"),
    # Query 11: broad operations analytics
    ("Senior Business Analyst, Operations Analytics", "Spring Health", "https://job-boards.greenhouse.io/springhealth66/jobs/4665786005", "broad-ops-analytics"),
    # Query 12: broad ERP/AI/PowerBI
    ("Senior Analyst, Finance Enabling Technology Automation (RPA & AI)", "Quest Diagnostics", "https://careers.questdiagnostics.com/job/norristown/senior-analyst-finance-enabling-technology-automation-rpa-and-ai/38852/93460103056", "broad-erp-ai"),
    ("Business Analyst, Automation & AI - Remote", "Experian", "https://jobs.experian.com/job/business-analyst-automation-and-ai-remote-in-costa-mesa-united-states-jid-3645", "broad-erp-ai"),
    # Greenhouse API: Anthropic
    ("Analytics Data Engineer", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4956672008", "greenhouse-api-anthropic"),
    ("Analytics Data Engineering Manager, Product", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5125387008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5055488008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5014500008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5116274008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer, Beneficial Deployments", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5068226008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer (Digital Natives Business)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5057647008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer, Life Sciences", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5111942008", "greenhouse-api-anthropic"),
    ("Applied AI Engineer (Startups)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5073277008", "greenhouse-api-anthropic"),
    ("Business Systems Analyst, Data Enrichment", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5127289008", "greenhouse-api-anthropic"),
    ("Senior Business Systems Analyst, Finance Systems", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4991194008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5076109008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5117581008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5117589008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Beneficial Deployments)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5062712008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Beneficial Deployments)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5146028008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Creatives)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5124533008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Digital Native Business)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5065835008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Federal Civilian)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5079540008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Government Technology)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5140405008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Industries)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4977626008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Industries)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4977624008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Industries)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5031670008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Industries)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4461444008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (National Security)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5079511008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Startups)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/4968059008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (Startups)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5057258008", "greenhouse-api-anthropic"),
    ("Solutions Architect, Applied AI (State and Local Government, West)", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5140403008", "greenhouse-api-anthropic"),
    ("Solutions Architect, National Security", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5126080008", "greenhouse-api-anthropic"),
    ("Revenue Systems Solution Architect", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5068721008", "greenhouse-api-anthropic"),
    ("Data Engineer, Safeguards", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/5156057008", "greenhouse-api-anthropic"),
    # Greenhouse API: Brex
    ("Data Engineer", "Brex", "https://www.brex.com/careers/8366850002?gh_jid=8366850002", "greenhouse-api-brex"),
    # Greenhouse API: Carta
    ("Data Engineering Tech Lead", "Carta", "https://job-boards.greenhouse.io/carta/jobs/7639199003", "greenhouse-api-carta"),
]

# Apply filters
filtered = []
seen_urls = set()

for title, company, url, source in all_candidates:
    base_url = url.split("?")[0].rstrip("/")

    if base_url in seen_urls:
        continue

    if not matches_positive(title):
        continue

    if matches_negative(title):
        continue

    seen_urls.add(base_url)
    seniority = has_seniority(title)
    filtered.append((title, company, url, source, seniority))

# Sort: seniority first, then by company
filtered.sort(key=lambda x: (not x[4], x[1], x[0]))

print(f"TOTAL CANDIDATES AFTER FILTER: {len(filtered)}")
print("---")
for title, company, url, source, senior in filtered:
    flag = " [SENIOR+]" if senior else ""
    print(f"{company} | {title}{flag} | {url} | {source}")

# Output pipeline.md entries
print("\n=== PIPELINE ENTRIES ===")
for title, company, url, source, senior in filtered:
    print(f"- [ ] {url} | {company} | {title}")

# Output scan-history.tsv entries
print("\n=== SCAN HISTORY ===")
for title, company, url, source, senior in filtered:
    print(f"{url}\t2026-04-06\t{source}\t{title}\t{company}\tadded")
