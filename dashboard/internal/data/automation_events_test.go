package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLastScannerHint(t *testing.T) {
	root := t.TempDir()
	events := filepath.Join(root, "data", "events")
	if err := os.MkdirAll(events, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(events, "2026-01-01.jsonl")
	if err := os.WriteFile(legacy, []byte(`{"type":"other","summary":"x"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	newer := filepath.Join(events, "2026-04-13.jsonl")
	body := `{"type":"scanner.run.completed","status":"success","summary":"42 new roles","recorded_at":"2026-04-13T18:00:00.000Z"}
{"type":"dashboard.generated","status":"success","summary":"dash"}
`
	if err := os.WriteFile(newer, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got := LastScannerHint(root)
	if got == "" {
		t.Fatal("expected non-empty hint")
	}
	if want := "Last scan 2026-04-13"; got[:len(want)] != want {
		t.Fatalf("got %q want prefix %q", got, want)
	}
}

func TestLastScannerHintMissingDir(t *testing.T) {
	root := t.TempDir()
	if got := LastScannerHint(root); got != "" {
		t.Fatalf("got %q want empty", got)
	}
}
