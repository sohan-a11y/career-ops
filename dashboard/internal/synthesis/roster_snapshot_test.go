package synthesis

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeRosterFixture(t *testing.T, path string, snap RosterSnapshot) {
	t.Helper()
	data, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

func TestRosterTelemetrySync_SnapshotMissingFile(t *testing.T) {
	dir := t.TempDir()
	sync := NewRosterTelemetrySync(filepath.Join(dir, "does-not-exist.json"), 50*time.Millisecond)

	snap, err := sync.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("expected no error for a not-yet-created telemetry file, got: %v", err)
	}
	if snap.TotalCompanies != 0 {
		t.Fatalf("expected zero-value snapshot, got %+v", snap)
	}
}

func TestRosterTelemetrySync_SnapshotReadsRealFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roster-telemetry.json")

	want := RosterSnapshot{
		Phase:          "discover",
		TotalCompanies: 2,
		Companies: []CompanyProgress{
			{Name: "Anthropic", Status: "resolved", Vendor: "greenhouse"},
			{Name: "Stripe", Status: "resolving"},
		},
		StartedAt: time.Now().UTC().Truncate(time.Second),
		UpdatedAt: time.Now().UTC().Truncate(time.Second),
		Done:      false,
	}
	writeRosterFixture(t, path, want)

	sync := NewRosterTelemetrySync(path, 50*time.Millisecond)
	got, err := sync.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Phase != want.Phase || got.TotalCompanies != want.TotalCompanies {
		t.Fatalf("snapshot mismatch: got %+v, want %+v", got, want)
	}
	if len(got.Companies) != 2 || got.Companies[0].Name != "Anthropic" || got.Companies[0].Vendor != "greenhouse" {
		t.Fatalf("companies not parsed correctly: %+v", got.Companies)
	}
}

func TestRosterTelemetrySync_SnapshotKeepsLastGoodOnMalformedJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roster-telemetry.json")

	good := RosterSnapshot{Phase: "scan", TotalCompanies: 1, Companies: []CompanyProgress{{Name: "Acme", Status: "scanned"}}}
	writeRosterFixture(t, path, good)

	sync := NewRosterTelemetrySync(path, 50*time.Millisecond)
	first, err := sync.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("unexpected error on first read: %v", err)
	}
	if first.Phase != "scan" {
		t.Fatalf("expected first read to succeed, got %+v", first)
	}

	// Corrupt the file mid-write (simulating a reader racing a writer that
	// hasn't finished — roster.mjs writes atomically via tmp+rename, but the
	// poller must still degrade gracefully against any malformed content).
	if err := os.WriteFile(path, []byte("{not valid json"), 0o644); err != nil {
		t.Fatalf("write corrupt fixture: %v", err)
	}

	second, err := sync.Snapshot(context.Background())
	if err == nil {
		t.Fatalf("expected an error reading malformed JSON")
	}
	if second.Phase != "scan" || second.TotalCompanies != 1 {
		t.Fatalf("expected last-known-good snapshot preserved on parse failure, got %+v", second)
	}
}

func TestRosterSnapshot_CountByStatus(t *testing.T) {
	snap := RosterSnapshot{
		Companies: []CompanyProgress{
			{Name: "A", Status: "resolved"},
			{Name: "B", Status: "resolved"},
			{Name: "C", Status: "unresolved"},
			{Name: "D", Status: "scanning"},
		},
	}
	counts := snap.CountByStatus()
	if counts["resolved"] != 2 {
		t.Fatalf("expected 2 resolved, got %d", counts["resolved"])
	}
	if counts["unresolved"] != 1 {
		t.Fatalf("expected 1 unresolved, got %d", counts["unresolved"])
	}
	if counts["scanning"] != 1 {
		t.Fatalf("expected 1 scanning, got %d", counts["scanning"])
	}
	if counts["done"] != 0 {
		t.Fatalf("expected 0 for a status with no companies, got %d", counts["done"])
	}
}

func TestRosterTelemetrySync_SubscribeClosesOnContextCancel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roster-telemetry.json")
	sync := NewRosterTelemetrySync(path, 20*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	ch := sync.Subscribe(ctx)
	cancel()

	select {
	case _, ok := <-ch:
		if ok {
			t.Fatalf("expected channel to be closed, got a value instead")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for subscribe channel to close after context cancel")
	}
}

func TestRosterTelemetrySync_CloseIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	sync := NewRosterTelemetrySync(filepath.Join(dir, "x.json"), 50*time.Millisecond)
	if err := sync.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := sync.Close(); err != nil {
		t.Fatalf("second Close should be a no-op, got: %v", err)
	}
}
