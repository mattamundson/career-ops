# Mode: contact — LinkedIn Power Move

## Step 0 — Template Check (preferred first step)

Before generating outreach from scratch, check for existing templates:

1. **Check** whether `templates/outreach/` contains any files
2. **Determine scenario** from context:
   - `recruiter` — inbound recruiter reach-out or cold recruiter message
   - `referral` — mutual connection or warm intro
   - `hiring-manager` — direct outreach to the person who owns the role
3. **Determine archetype** from the evaluation report (Block A of `offer.md`). If no report exists yet, infer from the JD: one of the 6 archetypes defined in `_shared.md`
4. **Run the selector**:
   ```
   node scripts/select-template.mjs \
     --scenario={scenario} \
     --archetype={archetype} \
     --channel={channel} \
     --company={company} \
     --role={role}
   ```
5. **Present the recommended template** filled with JD-specific data (company name, role, relevant proof point)
6. **Allow editing** before sending — ask "Any edits before I finalize?"
7. **After sending**, log the variant used by appending `[variant:{id}]` to the Notes column for that row in `applications.md`

If no template fits the scenario, fall back to custom generation (Step 1 below).

---

## Step 1 — Custom Generation (fallback)

1. **Identify targets** via WebSearch:
   - Hiring manager of the team
   - Assigned recruiter
   - 2-3 peers on the team (people with a similar role)

2. **Select primary target**: the person who would most benefit from the candidate being there

3. **Generate message** with 3-sentence framework:
   - **Sentence 1 (Hook)**: Something specific about their company or current data/AI challenge (NOT generic)
   - **Sentence 2 (Proof)**: Candidate's biggest quantifiable achievement relevant to THAT role (e.g., "I built an operational intelligence pipeline that replaced manual purchasing decisions with real-time AI alerts at a manufacturing company")
   - **Sentence 3 (Proposal)**: Quick chat, no pressure ("Would love to chat about [specific topic] for 15 min")

4. **Versions**:
   - EN (default)

5. **Alternative targets** with justification for why they're good second choices

**Message rules:**
- Maximum 300 characters (LinkedIn connection request limit)
- NO corporate-speak
- NO "I'm passionate about..."
- Something that makes them want to respond
- NEVER share phone number
