package data

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseApplicationsLines_trackerRowNumbers(t *testing.T) {
	md := `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 025 | 2026-04-09 | Agility Robotics | Manager, BI | 3.8/5 | GO | ✅ | [025](reports/025-agility-robotics-2026-04-09.md) | Remote |
| 001 | 2026-04-06 | Panopto | DataOps | 3.2/5 | Ready to Submit | ✅ | [001](reports/001-panopto-2026-04-06.md) | Stale |
`
	lines := strings.Split(md, "\n")
	apps := parseApplicationsLines(lines)
	if len(apps) != 2 {
		t.Fatalf("want 2 apps, got %d", len(apps))
	}
	if apps[0].Number != 25 || apps[0].Company != "Agility Robotics" || apps[0].Status != "GO" {
		t.Fatalf("first row: %#v", apps[0])
	}
	if apps[1].Number != 1 || apps[1].Company != "Panopto" {
		t.Fatalf("second row: %#v", apps[1])
	}
	if !apps[0].HasPDF || !apps[1].HasPDF {
		t.Fatalf("HasPDF want true: %#v %#v", apps[0], apps[1])
	}
	if apps[0].ReportPath != "reports/025-agility-robotics-2026-04-09.md" {
		t.Fatalf("ReportPath: %q", apps[0].ReportPath)
	}
}

func TestParseApplicationsLines_skipsHeaderAndInvalidID(t *testing.T) {
	md := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n| x | 2026-01-01 | Co | R | 1/5 | SKIP | — | [1](r.md) | n |\n"
	apps := parseApplicationsLines(strings.Split(md, "\n"))
	if len(apps) != 0 {
		t.Fatalf("want 0 apps, got %d", len(apps))
	}
}

func TestParseApplications_prefersDataDirectoryTracker(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}

	rootTracker := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 001 | 2026-04-01 | Root Co | Root Role | 1.0/5 | SKIP | ❌ | [001](reports/root.md) | Root |\n"
	dataTracker := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 002 | 2026-04-02 | Data Co | Data Role | 4.0/5 | GO | ✅ | [002](reports/data.md) | Data |\n"

	if err := os.WriteFile(filepath.Join(root, "applications.md"), []byte(rootTracker), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data", "applications.md"), []byte(dataTracker), 0o644); err != nil {
		t.Fatal(err)
	}

	apps := ParseApplications(root)
	if len(apps) != 1 {
		t.Fatalf("want 1 app, got %d", len(apps))
	}
	if apps[0].Company != "Data Co" || apps[0].Number != 2 {
		t.Fatalf("expected data/applications.md to win, got %#v", apps[0])
	}
}

func TestUpdateApplicationStatus_updatesDataDirectoryTracker(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}

	rootTracker := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 001 | 2026-04-01 | Root Co | Root Role | 1.0/5 | SKIP | ❌ | [001](reports/root.md) | Root |\n"
	dataTracker := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 002 | 2026-04-02 | Data Co | Data Role | 4.0/5 | Evaluated | ✅ | [002](reports/data.md) | Data |\n"

	if err := os.WriteFile(filepath.Join(root, "applications.md"), []byte(rootTracker), 0o644); err != nil {
		t.Fatal(err)
	}
	dataPath := filepath.Join(root, "data", "applications.md")
	if err := os.WriteFile(dataPath, []byte(dataTracker), 0o644); err != nil {
		t.Fatal(err)
	}

	app := ParseApplications(root)[0]
	if err := UpdateApplicationStatus(root, app, "Applied"); err != nil {
		t.Fatalf("UpdateApplicationStatus error: %v", err)
	}

	updatedData, err := os.ReadFile(dataPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(updatedData), "| 002 | 2026-04-02 | Data Co | Data Role | 4.0/5 | Applied |") {
		t.Fatalf("expected data/applications.md to be updated, got:\n%s", string(updatedData))
	}

	rootContent, err := os.ReadFile(filepath.Join(root, "applications.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rootContent), "Applied") {
		t.Fatalf("root applications.md should remain untouched, got:\n%s", string(rootContent))
	}
}
