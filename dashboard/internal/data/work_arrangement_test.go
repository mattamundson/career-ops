package data

import "testing"

func TestClassifyWorkArrangement_HybridBeforeRemoteKeyword(t *testing.T) {
	if g := ClassifyWorkArrangement("VERIFIED REMOTE — fully remote with optional hybrid near Salem OR", "", "", "", ""); g != ArrangementOnsiteHybrid {
		t.Fatalf("expected hybrid bucket when hybrid appears, got %q", g)
	}
}

func TestClassifyWorkArrangement_RemoteRoleTitle(t *testing.T) {
	if g := ClassifyWorkArrangement("", "Senior Data Engineer - Remote US", "", "", ""); g != ArrangementRemote {
		t.Fatalf("expected remote, got %q", g)
	}
}

func TestClassifyWorkArrangement_Minneapolis(t *testing.T) {
	if g := ClassifyWorkArrangement("", "BI Developer", "", "Minneapolis hybrid 2d/wk office", ""); g != ArrangementOnsiteHybrid {
		t.Fatalf("expected onsite_hybrid for MSP hybrid in notes, got %q", g)
	}
}

func TestFocusSortKey_RemoteHighStillStrong(t *testing.T) {
	remoteKey := FocusSortKey(5.0, "fully remote", "", "", "", "")
	hybridKey := FocusSortKey(4.0, "hybrid minneapolis", "", "", "", "")
	if remoteKey <= hybridKey {
		t.Fatalf("5.0 remote (%.3f) should beat 4.0 hybrid (%.3f)", remoteKey, hybridKey)
	}
}

func TestFocusSortKey_SimilarScorePrefersHybrid(t *testing.T) {
	remoteKey := FocusSortKey(4.5, "remote", "", "", "", "")
	hybridKey := FocusSortKey(4.5, "hybrid", "same", "", "", "")
	if hybridKey <= remoteKey {
		t.Fatalf("same score: hybrid (%.3f) should exceed remote (%.3f)", hybridKey, remoteKey)
	}
}
