package synthesis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

// TelemetrySync implements IStateProvider by reading pipeline state from
// a local JSON file or a memory-mapped byte slice.  It is designed to
// consume real-time telemetry without knowing how the TypeScript backend
// generates it.
//
// Two consumption modes (selected at construction):
//
//   1. File-based: reads a JSON file written atomically by the TypeScript
//      orchestrator.  The file is re-read on each Snapshot() call; change
//      notifications are driven by polling the file's mtime.
//
//   2. Memory-based: reads from a caller-supplied byte slice (e.g., a
//      shared-memory region or an in-process buffer).  Change notifications
//      are driven by explicit Notify() calls from the data producer.
//
// Both modes produce identical PipelineSnapshot values — the dashboard
// does not know which mode is active.
type TelemetrySync struct {
	mu sync.RWMutex

	// File mode
	filePath string

	// Memory mode
	memorySource func() ([]byte, error)

	// Shared state
	lastSnapshot PipelineSnapshot
	lastModTime  time.Time
	subscribers  []chan struct{}
	closed       bool

	// Polling interval for file mode (default 500ms).
	pollInterval time.Duration
}

// ── Constructors ────────────────────────────────────────────────────

// FileOption configures a file-based TelemetrySync.
type FileOption func(*TelemetrySync)

// WithPollInterval sets the polling interval for file-based change
// detection.  Default: 500ms.
func WithPollInterval(d time.Duration) FileOption {
	return func(ts *TelemetrySync) {
		if d > 0 {
			ts.pollInterval = d
		}
	}
}

// NewFromFile creates a TelemetrySync that reads pipeline state from
// a JSON file at the given path.
func NewFromFile(path string, opts ...FileOption) *TelemetrySync {
	ts := &TelemetrySync{
		filePath:     path,
		pollInterval: 500 * time.Millisecond,
	}
	for _, opt := range opts {
		opt(ts)
	}
	return ts
}

// NewFromMemory creates a TelemetrySync that reads pipeline state from
// a caller-supplied byte-source function.  The function is called on
// each Snapshot() and must return valid JSON.
func NewFromMemory(source func() ([]byte, error)) *TelemetrySync {
	return &TelemetrySync{
		memorySource: source,
		pollInterval: 500 * time.Millisecond,
	}
}

// ── IStateProvider implementation ───────────────────────────────────

// Snapshot returns the most recent pipeline state.  Safe for concurrent
// calls from the Bubble Tea update loop.
func (ts *TelemetrySync) Snapshot(ctx context.Context) (PipelineSnapshot, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return ts.lastSnapshot, nil
	}

	data, err := ts.readSource()
	if err != nil {
		// Return last-known-good snapshot on transient read failures.
		return ts.lastSnapshot, fmt.Errorf("telemetry read failed: %w", err)
	}

	if data == nil {
		// Source not yet available (file doesn't exist yet).
		return ts.lastSnapshot, nil
	}

	var snap PipelineSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return ts.lastSnapshot, fmt.Errorf("telemetry parse failed: %w", err)
	}

	snap.SnapshotAt = time.Now()
	ts.lastSnapshot = snap
	return snap, nil
}

// Subscribe returns a channel that emits a signal whenever the pipeline
// state changes.  The channel is closed when ctx is cancelled or Close()
// is called.
func (ts *TelemetrySync) Subscribe(ctx context.Context) <-chan struct{} {
	ch := make(chan struct{}, 1)

	ts.mu.Lock()
	if ts.closed {
		ts.mu.Unlock()
		close(ch)
		return ch
	}
	ts.subscribers = append(ts.subscribers, ch)
	ts.mu.Unlock()

	// If file-based, start polling in a goroutine.
	if ts.filePath != "" {
		go ts.pollFileChanges(ctx, ch)
	}

	// Context cancellation cleanup.
	go func() {
		<-ctx.Done()
		ts.removeSub(ch)
		close(ch)
	}()

	return ch
}

// Close releases resources.  Safe to call multiple times.
func (ts *TelemetrySync) Close() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return nil
	}
	ts.closed = true

	for _, ch := range ts.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	ts.subscribers = nil
	return nil
}

// ── Memory mode: explicit notification ──────────────────────────────

// Notify signals all subscribers that the pipeline state has changed.
// Use this in memory mode when the data producer writes new state.
// No-op in file mode (file polling handles notification).
func (ts *TelemetrySync) Notify() {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	for _, ch := range ts.subscribers {
		select {
		case ch <- struct{}{}:
		default:
			// Non-blocking: subscriber hasn't consumed the last signal.
		}
	}
}

// ── Internal helpers ────────────────────────────────────────────────

// readSource returns raw JSON bytes from the configured source.
// Returns (nil, nil) when the source doesn't exist yet.
func (ts *TelemetrySync) readSource() ([]byte, error) {
	if ts.memorySource != nil {
		return ts.memorySource()
	}

	data, err := os.ReadFile(ts.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}

// pollFileChanges polls the file's mtime and sends a change signal
// when it differs from the last observed mtime.
func (ts *TelemetrySync) pollFileChanges(ctx context.Context, ch chan<- struct{}) {
	ticker := time.NewTicker(ts.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ts.mu.RLock()
			closed := ts.closed
			ts.mu.RUnlock()
			if closed {
				return
			}

			info, err := os.Stat(ts.filePath)
			if err != nil {
				continue // File not yet created or temporarily locked.
			}

			ts.mu.Lock()
			if info.ModTime().After(ts.lastModTime) {
				ts.lastModTime = info.ModTime()
				ts.mu.Unlock()

				select {
				case ch <- struct{}{}:
				default:
				}
			} else {
				ts.mu.Unlock()
			}
		}
	}
}

// removeSub removes a subscriber channel from the list.
func (ts *TelemetrySync) removeSub(target chan struct{}) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	for i, ch := range ts.subscribers {
		if ch == target {
			ts.subscribers = append(ts.subscribers[:i], ts.subscribers[i+1:]...)
			return
		}
	}
}
