package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var reDatedEventJSONL = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}\.jsonl$`)

// LastScannerHint returns a short line from the latest scanner.run.completed in data/events, or "".
func LastScannerHint(careerOpsPath string) string {
	eventsDir := filepath.Join(careerOpsPath, "data", "events")
	ents, err := os.ReadDir(eventsDir)
	if err != nil {
		return ""
	}

	var files []string
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !reDatedEventJSONL.MatchString(name) {
			continue
		}
		files = append(files, name)
	}
	if len(files) == 0 {
		return ""
	}
	sort.Slice(files, func(i, j int) bool { return files[i] > files[j] })

	type eventLine struct {
		Type       string `json:"type"`
		Status     string `json:"status"`
		Summary    string `json:"summary"`
		RecordedAt string `json:"recorded_at"`
	}

	for _, fn := range files {
		raw, err := os.ReadFile(filepath.Join(eventsDir, fn))
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if line == "" {
				continue
			}
			var ev eventLine
			if json.Unmarshal([]byte(line), &ev) != nil {
				continue
			}
			if ev.Type != "scanner.run.completed" {
				continue
			}
			h := strings.TrimSpace(ev.Summary)
			if h == "" {
				h = ev.Status
			}
			if len(h) > 72 {
				h = h[:69] + "..."
			}
			if len(ev.RecordedAt) >= 10 {
				return "Last scan " + ev.RecordedAt[:10] + " — " + h
			}
			return h
		}
	}
	return ""
}
