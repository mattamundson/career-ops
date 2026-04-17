package data

import "testing"

func TestClassifyWorkArrangement_NonMspFullyRemoteWithHybrid_ReturnsRemote(t *testing.T) {
	// Salem OR is non-MSP; the "fully remote" signal wins over "optional hybrid" for a MN candidate.
	if g := ClassifyWorkArrangement("VERIFIED REMOTE — fully remote with optional hybrid near Salem OR", "", "", "", ""); g != ArrangementRemote {
		t.Fatalf("expected remote for non-MSP fully-remote-with-optional-hybrid, got %q", g)
	}
}

func TestClassifyWorkArrangement_RemoteRoleTitle(t *testing.T) {
	if g := ClassifyWorkArrangement("", "Senior Data Engineer - Remote US", "", "", ""); g != ArrangementRemote {
		t.Fatalf("expected remote, got %q", g)
	}
}

func TestClassifyWorkArrangement_MinneapolisHybrid(t *testing.T) {
	if g := ClassifyWorkArrangement("", "BI Developer", "", "Minneapolis hybrid 2d/wk office", ""); g != ArrangementHybridMsp {
		t.Fatalf("expected hybrid_msp for MSP hybrid in notes, got %q", g)
	}
}

func TestClassifyWorkArrangement_MinneapolisOnsite(t *testing.T) {
	if g := ClassifyWorkArrangement("Minneapolis, MN — on-site", "", "", "", ""); g != ArrangementOnsiteMsp {
		t.Fatalf("expected onsite_msp for MSP on-site, got %q", g)
	}
}

func TestClassifyWorkArrangement_MinneapolisOnly_DefaultsToOnsite(t *testing.T) {
	if g := ClassifyWorkArrangement("Minneapolis, MN", "", "", "", ""); g != ArrangementOnsiteMsp {
		t.Fatalf("expected onsite_msp for MSP-only (no mode indicator), got %q", g)
	}
}

func TestClassifyWorkArrangement_NonMspOnsite_Unknown(t *testing.T) {
	if g := ClassifyWorkArrangement("", "Engineer — Austin TX on-site", "", "", ""); g != ArrangementUnknown {
		t.Fatalf("expected unknown for non-MSP on-site (unreachable for MN candidate), got %q", g)
	}
}

func TestFocusSortKey_RemoteHighStillBeatsHybridMid(t *testing.T) {
	// 5.0 remote (5.0 * 0.85 = 4.25) still beats 3.5 hybrid_msp (3.5 * 1.10 = 3.85).
	remoteKey := FocusSortKey(5.0, "fully remote", "", "", "", "")
	hybridKey := FocusSortKey(3.5, "hybrid minneapolis", "", "", "", "")
	if remoteKey <= hybridKey {
		t.Fatalf("5.0 remote (%.3f) should beat 3.5 hybrid_msp (%.3f)", remoteKey, hybridKey)
	}
}

func TestFocusSortKey_SameScorePrefersOnsiteOverHybridOverRemote(t *testing.T) {
	onsiteKey := FocusSortKey(4.5, "minneapolis on-site", "", "", "", "")
	hybridKey := FocusSortKey(4.5, "minneapolis hybrid", "", "", "", "")
	remoteKey := FocusSortKey(4.5, "remote", "", "", "", "")
	if !(onsiteKey > hybridKey && hybridKey > remoteKey) {
		t.Fatalf("same-score priority must be onsite_msp (%.3f) > hybrid_msp (%.3f) > remote (%.3f)",
			onsiteKey, hybridKey, remoteKey)
	}
}
