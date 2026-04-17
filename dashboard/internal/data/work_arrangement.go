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

// PriorityRankMultipliers map the ordered work_modes array (index 0 = top priority)
// to scoring multipliers. Keep in sync with scripts/lib/scoring-core.mjs.
var PriorityRankMultipliers = [3]float64{1.20, 1.10, 0.85}

// UnknownMultiplier applies to non-MSP on-site/hybrid postings (unreachable).
const UnknownMultiplier = 0.95

// DefaultWorkModes reflects the default priority: on-site MSP > hybrid MSP > remote.
var DefaultWorkModes = [3]string{"on_site", "hybrid", "remote"}

// LocationPriorityConfig holds the derived multipliers for each bucket.
type LocationPriorityConfig struct {
	OnsiteMsp float64
	HybridMsp float64
	Remote    float64
	Unknown   float64
}

// DeriveLocationPriority computes multipliers from an ordered work_modes slice.
// Accepts the 3 canonical modes: on_site, hybrid, remote.
func DeriveLocationPriority(workModes []string) LocationPriorityConfig {
	order := DefaultWorkModes[:]
	if len(workModes) == 3 {
		order = workModes
	}
	indexOf := func(mode string) int {
		for i, v := range order {
			if v == mode {
				return i
			}
		}
		return -1
	}
	multFor := func(mode string) float64 {
		i := indexOf(mode)
		if i < 0 || i >= len(PriorityRankMultipliers) {
			return UnknownMultiplier
		}
		return PriorityRankMultipliers[i]
	}
	return LocationPriorityConfig{
		OnsiteMsp: multFor("on_site"),
		HybridMsp: multFor("hybrid"),
		Remote:    multFor("remote"),
		Unknown:   UnknownMultiplier,
	}
}

// DefaultLocationPriority is the config used when no profile override is passed.
var DefaultLocationPriority = DeriveLocationPriority(DefaultWorkModes[:])

// LocationPriorityMultiplier returns the multiplier for a given arrangement under the default config.
// Callers with profile data should use LocationPriorityMultiplierWithConfig.
func LocationPriorityMultiplier(a WorkArrangement) float64 {
	return LocationPriorityMultiplierWithConfig(a, DefaultLocationPriority)
}

// LocationPriorityMultiplierWithConfig applies a custom config (e.g. from profile.yml).
func LocationPriorityMultiplierWithConfig(a WorkArrangement, cfg LocationPriorityConfig) float64 {
	switch a {
	case ArrangementOnsiteMsp:
		return cfg.OnsiteMsp
	case ArrangementHybridMsp:
		return cfg.HybridMsp
	case ArrangementRemote:
		return cfg.Remote
	default:
		return cfg.Unknown
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
