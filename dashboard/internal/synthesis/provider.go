// Package synthesis defines the state-provider abstraction that decouples
// the Go TUI dashboard from the TypeScript synthesis pipeline.
//
// The dashboard reads pipeline telemetry through the IStateProvider interface.
// It never knows — and must never assume — how the TypeScript backend
// generates, stores, or streams the data.
package synthesis

import (
	"context"
	"time"
)

// ── Domain types (Go-side mirrors of the TypeScript pipeline events) ──

// SynthesisStage identifies a stage in the synthesis pipeline.
type SynthesisStage string

const (
	StageExtract    SynthesisStage = "extract"
	StageAnalyze    SynthesisStage = "analyze"
	StageSynthesize SynthesisStage = "synthesize"
	StageTailor     SynthesisStage = "tailor"
	StageMerge      SynthesisStage = "merge"
	StageCompile    SynthesisStage = "compile"
)

// StageStatus describes the current state of a single pipeline stage.
type StageStatus string

const (
	StatusPending  StageStatus = "pending"
	StatusRunning  StageStatus = "running"
	StatusComplete StageStatus = "complete"
	StatusFailed   StageStatus = "failed"
)

// StageSnapshot is an immutable snapshot of a single pipeline stage at
// the moment the provider last read the underlying source.
type StageSnapshot struct {
	Stage      SynthesisStage `json:"stage"`
	Status     StageStatus    `json:"status"`
	DurationMs float64        `json:"duration_ms,omitempty"`
	Error      string         `json:"error,omitempty"`
	Timestamp  time.Time      `json:"timestamp"`
}

// MergeStatsSnapshot mirrors the TypeScript MergeStats type.
type MergeStatsSnapshot struct {
	TotalImmutableEntries int      `json:"total_immutable_entries"`
	MatchedEntries        int      `json:"matched_entries"`
	UnmatchedEntries      int      `json:"unmatched_entries"`
	OrphanedMutableKeys   []string `json:"orphaned_mutable_keys"`
	MergedAt              string   `json:"merged_at"`
}

// PipelineSnapshot is the aggregate state of the entire synthesis pipeline
// at a point in time.  The dashboard's Bubble Tea model reads this on every
// tick and re-renders the progress screen from it.
type PipelineSnapshot struct {
	// Per-stage status, keyed by stage name for O(1) lookup.
	Stages map[SynthesisStage]StageSnapshot `json:"stages"`

	// Merge statistics (non-nil only after the merge stage completes).
	MergeStats *MergeStatsSnapshot `json:"merge_stats,omitempty"`

	// Total pipeline duration (zero until the pipeline completes).
	TotalMs float64 `json:"total_ms,omitempty"`

	// True when the pipeline has finished (success or failure).
	Done bool `json:"done"`

	// Non-empty when the pipeline terminated with an error.
	FinalError string `json:"final_error,omitempty"`

	// ISO-8601 timestamp of this snapshot.
	SnapshotAt time.Time `json:"snapshot_at"`
}

// ── The provider interface ──────────────────────────────────────────

// IStateProvider is the single read-path the dashboard uses to observe
// synthesis pipeline state.  Implementations may read from:
//
//   - A local JSON file written by the TypeScript orchestrator
//   - A memory-mapped stream (shared-memory IPC)
//   - A Unix socket / named pipe carrying newline-delimited JSON events
//   - An HTTP/SSE endpoint served by the orchestrator
//
// The dashboard does not know which — it calls Snapshot() on a tick
// and renders whatever comes back.
type IStateProvider interface {
	// Snapshot returns the most recent pipeline state.  Implementations
	// must be safe for concurrent calls from the Bubble Tea update loop.
	//
	// Returning a non-nil error means the data source is temporarily
	// unavailable (file locked, stream interrupted).  The dashboard
	// should display the last-known-good snapshot with a stale indicator
	// rather than crashing.
	Snapshot(ctx context.Context) (PipelineSnapshot, error)

	// Subscribe returns a channel that emits a value whenever the
	// pipeline state changes.  The channel is closed when the context
	// is cancelled or the data source is exhausted.
	//
	// The emitted value is intentionally empty — it is a change signal,
	// not the data itself.  The caller must call Snapshot() to read the
	// actual state.  This avoids duplicating the snapshot in the channel
	// buffer and lets the caller coalesce rapid updates.
	//
	// Implementations that poll (e.g., file-based) should debounce
	// notifications to avoid busy-looping.
	Subscribe(ctx context.Context) <-chan struct{}

	// Close releases underlying resources (file handles, watchers,
	// connections).  Safe to call multiple times.
	Close() error
}
