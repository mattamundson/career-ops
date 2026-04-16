package data

import "strings"

// WorkArrangement classifies JD / report wording for Minneapolis-area prioritization:
// in-office and hybrid sort above fully-remote at similar scores (see scoring-core.mjs — keep in sync).
type WorkArrangement string

const (
	ArrangementOnsiteHybrid WorkArrangement = "onsite_hybrid"
	ArrangementRemote       WorkArrangement = "remote"
	ArrangementUnknown      WorkArrangement = "unknown"
)

// ClassifyWorkArrangement merges remote line, role title, notes, and report snippets (TL;DR, why).
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

	if hasHybrid || hasOnsite || mspLocal {
		return ArrangementOnsiteHybrid
	}

	if strings.Contains(blob, "100% remote") || strings.Contains(blob, "fully remote") ||
		strings.Contains(blob, "fully-remote") || strings.Contains(blob, "remote only") ||
		strings.Contains(blob, "work from anywhere") || strings.Contains(blob, "verified remote") ||
		strings.Contains(blob, "verifiable remote") {
		return ArrangementRemote
	}
	if strings.Contains(blob, "remote") || strings.Contains(blob, "wfh") ||
		strings.Contains(blob, "work from home") {
		return ArrangementRemote
	}
	return ArrangementUnknown
}

// LocationPriorityMultiplier boosts hybrid/on-site vs remote for the same headline score.
func LocationPriorityMultiplier(a WorkArrangement) float64 {
	switch a {
	case ArrangementOnsiteHybrid:
		return 1.06
	case ArrangementRemote:
		return 0.92
	default:
		return 1.0
	}
}

// FocusSortKey is used for TUI "focus" sort: score * location multiplier (high remote can still outrank mid hybrid).
func FocusSortKey(score float64, remote, role, notes, tldr, why string) float64 {
	if score <= 0 {
		return 0
	}
	a := ClassifyWorkArrangement(remote, role, notes, tldr, why)
	return score * LocationPriorityMultiplier(a)
}
