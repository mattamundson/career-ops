package data

import "strings"

// WorkArrangement classifies JD / report wording for Minneapolis-anchored prioritization:
// on-site MSP > hybrid MSP > unknown > remote. Non-MSP on-site/hybrid classifies as
// unknown (physically unreachable from Minneapolis). Keep in sync with scripts/lib/scoring-core.mjs.
type WorkArrangement string

const (
	ArrangementOnsiteMsp WorkArrangement = "onsite_msp"
	ArrangementHybridMsp WorkArrangement = "hybrid_msp"
	ArrangementRemote    WorkArrangement = "remote"
	ArrangementUnknown   WorkArrangement = "unknown"
)

// ClassifyWorkArrangement merges remote line, role title, notes, and report snippets (TL;DR, why).
// Priority:
//  1. MSP-local + hybrid → hybrid_msp
//  2. MSP-local (any or no mode) → onsite_msp
//  3. Strong-remote keywords → remote
//  4. Non-MSP on-site/hybrid → unknown (unreachable for MN-based candidate)
//  5. Weak-remote keywords → remote
//  6. else → unknown
func ClassifyWorkArrangement(remote, role, notes, tldr, why string) WorkArrangement {
	blob := strings.ToLower(strings.TrimSpace(
		strings.Join([]string{remote, role, notes, tldr, why}, " "),
	))
	if blob == "" {
		return ArrangementUnknown
	}

	hasHybrid := strings.Contains(blob, "hybrid")
	hasOnsite := strings.Contains(blob, "on-site") || strings.Contains(blob, "onsite") ||
		strings.Contains(blob, "in-office") || strings.Contains(blob, "in office") ||
		strings.Contains(blob, "office-based") || strings.Contains(blob, "office based") ||
		strings.Contains(blob, "in person") || strings.Contains(blob, "on site")
	mspLocal := strings.Contains(blob, "minneapolis") || strings.Contains(blob, "st. paul") ||
		strings.Contains(blob, "st paul") || strings.Contains(blob, "twin cities") ||
		strings.Contains(blob, "eden prairie") || strings.Contains(blob, "plymouth") ||
		strings.Contains(blob, "golden valley") || strings.Contains(blob, "bloomington")
	strongRemote := strings.Contains(blob, "100% remote") || strings.Contains(blob, "fully remote") ||
		strings.Contains(blob, "fully-remote") || strings.Contains(blob, "remote only") ||
		strings.Contains(blob, "work from anywhere") || strings.Contains(blob, "verified remote") ||
		strings.Contains(blob, "verifiable remote")
	weakRemote := strings.Contains(blob, "remote") || strings.Contains(blob, "wfh") ||
		strings.Contains(blob, "work from home")

	if mspLocal && hasHybrid {
		return ArrangementHybridMsp
	}
	if mspLocal {
		return ArrangementOnsiteMsp
	}
	if strongRemote {
		return ArrangementRemote
	}
	if hasHybrid || hasOnsite {
		return ArrangementUnknown
	}
	if weakRemote {
		return ArrangementRemote
	}
	return ArrangementUnknown
}

// LocationPriorityMultiplier: on-site MSP gets the biggest boost, hybrid MSP middle,
// unknown slight penalty, remote strongest penalty (still searchable for high-fit jobs).
func LocationPriorityMultiplier(a WorkArrangement) float64 {
	switch a {
	case ArrangementOnsiteMsp:
		return 1.20
	case ArrangementHybridMsp:
		return 1.10
	case ArrangementRemote:
		return 0.85
	default:
		return 0.95
	}
}

// FocusSortKey: score * location multiplier. High remote can still outrank mid hybrid_msp,
// but same-score roles sort on-site MSP > hybrid MSP > unknown > remote.
func FocusSortKey(score float64, remote, role, notes, tldr, why string) float64 {
	if score <= 0 {
		return 0
	}
	a := ClassifyWorkArrangement(remote, role, notes, tldr, why)
	return score * LocationPriorityMultiplier(a)
}
