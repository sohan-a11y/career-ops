package synthesis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

// RosterSnapshot mirrors the JSON roster.mjs writes to
// data/roster-telemetry.json as it works through an Excel company roster:
// ingest → discover (ATS resolution) → scan (optional) → done. Unlike
// PipelineSnapshot (one job's six stages), this tracks MANY companies at
// once, each with its own status — a roster run and a single-job synthesis
// run are different shapes by nature, so this is a sibling type, not a
// variant of PipelineSnapshot.
type RosterSnapshot struct {
	// Which phase the roster run is currently in: "ingest", "discover",
	// "scan", or "done".
	Phase string `json:"phase"`

	// Total number of companies parsed from the roster file.
	TotalCompanies int `json:"totalCompanies"`

	// Per-company progress, in the roster file's original row order.
	Companies []CompanyProgress `json:"companies"`

	// ISO-8601 timestamp the run started.
	StartedAt time.Time `json:"startedAt"`

	// ISO-8601 timestamp of this snapshot.
	UpdatedAt time.Time `json:"updatedAt"`

	// True once the run has reached its final "done" phase.
	Done bool `json:"done"`
}

// CompanyProgress is one company's status within a roster run.
type CompanyProgress struct {
	Name string `json:"name"`

	// One of: "pending", "resolving", "resolved", "unresolved",
	// "scanning", "scanned", "error".
	Status string `json:"status"`

	// The resolved ATS vendor (greenhouse/ashby/lever/workday), once known.
	Vendor string `json:"vendor,omitempty"`

	// Live postings found for this company, once scanned.
	JobsFound int `json:"jobsFound,omitempty"`

	// Non-empty when Status is "unresolved" or "error".
	Error string `json:"error,omitempty"`
}

// CountByStatus tallies companies per status — the roster-watch TUI's
// summary line reads this instead of re-walking Companies itself.
func (s RosterSnapshot) CountByStatus() map[string]int {
	counts := make(map[string]int, 8)
	for _, c := range s.Companies {
		counts[c.Status]++
	}
	return counts
}

// ── A dedicated, minimal file-poller for RosterSnapshot ────────────────
//
// This intentionally does NOT reuse TelemetrySync: TelemetrySync's public
// Snapshot() is typed to PipelineSnapshot, and retrofitting generics onto
// an already-published interface (IStateProvider) for one new caller isn't
// worth the risk to code the rest of the dashboard may come to depend on.
// A second small, single-purpose poller is easier to reason about than a
// shared generic one bolted on after the fact.

// RosterTelemetrySync reads RosterSnapshot state from the JSON file
// roster.mjs writes, polling for changes so a live TUI can tail a run.
type RosterTelemetrySync struct {
	mu sync.RWMutex

	filePath     string
	pollInterval time.Duration

	lastSnapshot RosterSnapshot
	lastModTime  time.Time
	subscribers  []chan struct{}
	closed       bool
}

// NewRosterTelemetrySync creates a poller for the given telemetry file path.
// pollInterval <= 0 defaults to 500ms.
func NewRosterTelemetrySync(path string, pollInterval time.Duration) *RosterTelemetrySync {
	if pollInterval <= 0 {
		pollInterval = 500 * time.Millisecond
	}
	return &RosterTelemetrySync{filePath: path, pollInterval: pollInterval}
}

// Snapshot returns the most recently read roster state. Safe for concurrent
// calls. Returns the last-known-good snapshot (never an error) when the file
// doesn't exist yet — a roster run may not have started writing telemetry.
func (r *RosterTelemetrySync) Snapshot(_ context.Context) (RosterSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.closed {
		return r.lastSnapshot, nil
	}

	data, err := os.ReadFile(r.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return r.lastSnapshot, nil
		}
		return r.lastSnapshot, fmt.Errorf("roster telemetry read failed: %w", err)
	}

	var snap RosterSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return r.lastSnapshot, fmt.Errorf("roster telemetry parse failed: %w", err)
	}

	r.lastSnapshot = snap
	return snap, nil
}

// Subscribe returns a channel that emits a signal whenever the telemetry
// file's mtime advances. Closed when ctx is cancelled or Close() is called.
func (r *RosterTelemetrySync) Subscribe(ctx context.Context) <-chan struct{} {
	ch := make(chan struct{}, 1)

	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		close(ch)
		return ch
	}
	r.subscribers = append(r.subscribers, ch)
	r.mu.Unlock()

	go r.poll(ctx, ch)
	go func() {
		<-ctx.Done()
		r.removeSub(ch)
		close(ch)
	}()

	return ch
}

// Close releases resources. Safe to call multiple times.
func (r *RosterTelemetrySync) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	r.subscribers = nil
	return nil
}

func (r *RosterTelemetrySync) poll(ctx context.Context, ch chan<- struct{}) {
	ticker := time.NewTicker(r.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.RLock()
			closed := r.closed
			r.mu.RUnlock()
			if closed {
				return
			}

			info, err := os.Stat(r.filePath)
			if err != nil {
				continue
			}

			r.mu.Lock()
			changed := info.ModTime().After(r.lastModTime)
			if changed {
				r.lastModTime = info.ModTime()
			}
			r.mu.Unlock()

			if changed {
				select {
				case ch <- struct{}{}:
				default:
				}
			}
		}
	}
}

func (r *RosterTelemetrySync) removeSub(target chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, ch := range r.subscribers {
		if ch == target {
			r.subscribers = append(r.subscribers[:i], r.subscribers[i+1:]...)
			return
		}
	}
}
