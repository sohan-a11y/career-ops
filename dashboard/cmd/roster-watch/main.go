// Command roster-watch is a standalone terminal dashboard that tails a
// career-ops roster run (see roster.mjs) live: ingest → discover → scan →
// done, one company at a time. It reads only data/roster-telemetry.json —
// it has no idea how roster.mjs produces that file, by design (see
// internal/synthesis.IStateProvider).
//
// This is deliberately a SEPARATE binary from the main dashboard (cmd
// package `dashboard`) rather than a new screen bolted onto its existing
// Bubble Tea state machine: a roster run's shape (many companies, each
// with its own status) doesn't fit the single-application pipeline view
// the main dashboard renders, and grafting it on risked destabilizing a
// screen router this change never needed to touch.
//
// Usage:
//
//	go run ./cmd/roster-watch --path /path/to/career-ops
//	go run ./cmd/roster-watch --path .. --interval 250ms
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/synthesis"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

type tickMsg time.Time

type model struct {
	sync    *synthesis.RosterTelemetrySync
	th      theme.Theme
	snap    synthesis.RosterSnapshot
	err     error
	width   int
	height  int
	started bool
}

func newModel(telemetryPath string, interval time.Duration, th theme.Theme) model {
	return model{
		sync: synthesis.NewRosterTelemetrySync(telemetryPath, interval),
		th:   th,
	}
}

func (m model) Init() tea.Cmd {
	return tick()
}

func tick() tea.Cmd {
	return tea.Tick(400*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			_ = m.sync.Close()
			return m, tea.Quit
		}
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tickMsg:
		snap, err := m.sync.Snapshot(context.Background())
		m.snap = snap
		m.err = err
		if snap.TotalCompanies > 0 {
			m.started = true
		}
		return m, tick()
	}
	return m, nil
}

func (m model) View() string {
	var b strings.Builder

	title := lipgloss.NewStyle().Bold(true).Foreground(m.th.Mauve).Render("career-ops · roster watch")
	b.WriteString(title + "\n")

	if !m.started {
		waiting := lipgloss.NewStyle().Foreground(m.th.Subtext).Render("Waiting for a roster run to start writing data/roster-telemetry.json…")
		b.WriteString(waiting + "\n\n")
		b.WriteString(m.renderHelp())
		return b.String()
	}

	if m.err != nil {
		errLine := lipgloss.NewStyle().Foreground(m.th.Red).Render(fmt.Sprintf("⚠ %s (showing last-known state)", m.err))
		b.WriteString(errLine + "\n")
	}

	b.WriteString(m.renderSummary())
	b.WriteString("\n")
	b.WriteString(m.renderTable())
	b.WriteString("\n")
	b.WriteString(m.renderHelp())

	return b.String()
}

func (m model) renderSummary() string {
	phaseStyle := lipgloss.NewStyle().Bold(true).Foreground(phaseColor(m.th, m.snap.Phase))
	elapsed := "-"
	if !m.snap.StartedAt.IsZero() {
		ref := m.snap.UpdatedAt
		if m.snap.Done {
			elapsed = ref.Sub(m.snap.StartedAt).Round(time.Second).String()
		} else {
			elapsed = time.Since(m.snap.StartedAt).Round(time.Second).String()
		}
	}

	counts := m.snap.CountByStatus()
	parts := []string{
		fmt.Sprintf("phase: %s", phaseStyle.Render(m.snap.Phase)),
		fmt.Sprintf("companies: %d", m.snap.TotalCompanies),
		fmt.Sprintf("elapsed: %s", elapsed),
	}

	line := strings.Join(parts, "   ")

	statusLine := fmt.Sprintf(
		"  %s %d  %s %d  %s %d  %s %d  %s %d",
		lipgloss.NewStyle().Foreground(m.th.Green).Render("✓ resolved"), counts["resolved"],
		lipgloss.NewStyle().Foreground(m.th.Yellow).Render("… resolving"), counts["resolving"],
		lipgloss.NewStyle().Foreground(m.th.Sky).Render("✓ scanned"), counts["scanned"],
		lipgloss.NewStyle().Foreground(m.th.Red).Render("✗ unresolved"), counts["unresolved"],
		lipgloss.NewStyle().Foreground(m.th.Red).Render("✗ error"), counts["error"],
	)

	return line + "\n" + statusLine + "\n"
}

func (m model) renderTable() string {
	var b strings.Builder
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(m.th.Subtext)
	b.WriteString(headerStyle.Render(fmt.Sprintf("  %-28s %-12s %-10s %-8s %s", "COMPANY", "STATUS", "VENDOR", "JOBS", "NOTE")) + "\n")

	for _, c := range m.snap.Companies {
		icon, color := statusIcon(m.th, c.Status)
		row := fmt.Sprintf("  %s %-26s %-12s %-10s %-8s %s",
			icon,
			truncate(c.Name, 26),
			c.Status,
			orDash(c.Vendor),
			jobsCell(c),
			truncate(c.Error, 40),
		)
		b.WriteString(lipgloss.NewStyle().Foreground(color).Render(row) + "\n")
	}

	return b.String()
}

func (m model) renderHelp() string {
	return lipgloss.NewStyle().Foreground(m.th.Overlay).Render("q/esc to quit · refreshes every 400ms from data/roster-telemetry.json")
}

func phaseColor(th theme.Theme, phase string) lipgloss.Color {
	switch phase {
	case "done":
		return th.Green
	case "scan":
		return th.Sky
	case "discover":
		return th.Yellow
	default:
		return th.Blue
	}
}

func statusIcon(th theme.Theme, status string) (string, lipgloss.Color) {
	switch status {
	case "resolved", "scanned":
		return "✓", th.Green
	case "resolving", "scanning", "pending":
		return "…", th.Yellow
	case "unresolved", "error":
		return "✗", th.Red
	default:
		return "?", th.Subtext
	}
}

func jobsCell(c synthesis.CompanyProgress) string {
	if c.JobsFound == 0 && c.Status != "scanned" {
		return "-"
	}
	return fmt.Sprintf("%d", c.JobsFound)
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n <= 1 {
		return s[:n]
	}
	return s[:n-1] + "…"
}

func main() {
	pathFlag := flag.String("path", ".", "path to the career-ops project root")
	intervalFlag := flag.Duration("interval", 500*time.Millisecond, "telemetry poll interval")
	themeFlag := flag.String("theme", "auto", "theme: auto | catppuccin-mocha | catppuccin-latte")
	flag.Parse()

	root, err := filepath.Abs(*pathFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "roster-watch: invalid --path: %v\n", err)
		os.Exit(1)
	}
	telemetryPath := filepath.Join(root, "data", "roster-telemetry.json")

	th := theme.NewTheme(*themeFlag)
	m := newModel(telemetryPath, *intervalFlag, th)

	p := tea.NewProgram(m)
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "roster-watch: %v\n", err)
		os.Exit(1)
	}
}
