package main

import (
	"strings"
	"testing"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/synthesis"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestTruncate(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"Anthropic", 26, "Anthropic"},
		{"", 5, ""},
		{"exactly5", 8, "exactly5"},
		{"a-very-long-company-name-here", 10, "a-very-lo…"},
		{"ab", 1, "a"},
	}
	for _, c := range cases {
		got := truncate(c.in, c.n)
		if got != c.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestOrDash(t *testing.T) {
	if orDash("") != "-" {
		t.Errorf("orDash(\"\") should be \"-\"")
	}
	if orDash("greenhouse") != "greenhouse" {
		t.Errorf("orDash should pass non-empty strings through")
	}
}

func TestJobsCell(t *testing.T) {
	if got := jobsCell(synthesis.CompanyProgress{Status: "resolving", JobsFound: 0}); got != "-" {
		t.Errorf("expected dash for unscanned zero-jobs company, got %q", got)
	}
	if got := jobsCell(synthesis.CompanyProgress{Status: "scanned", JobsFound: 0}); got != "0" {
		t.Errorf("expected explicit 0 for a scanned company with no jobs, got %q", got)
	}
	if got := jobsCell(synthesis.CompanyProgress{Status: "resolved", JobsFound: 578}); got != "578" {
		t.Errorf("expected 578, got %q", got)
	}
}

func TestStatusIcon(t *testing.T) {
	th := theme.NewTheme("catppuccin-mocha")
	icon, color := statusIcon(th, "resolved")
	if icon != "✓" || color != th.Green {
		t.Errorf("resolved should render a green check, got icon=%q color=%v", icon, color)
	}
	icon, color = statusIcon(th, "unresolved")
	if icon != "✗" || color != th.Red {
		t.Errorf("unresolved should render a red cross, got icon=%q color=%v", icon, color)
	}
	icon, _ = statusIcon(th, "some-unknown-future-status")
	if icon != "?" {
		t.Errorf("unknown status should fall back to '?', got %q", icon)
	}
}

func TestViewRendersWithoutPanicking(t *testing.T) {
	th := theme.NewTheme("catppuccin-mocha")
	m := model{
		th: th,
		snap: synthesis.RosterSnapshot{
			Phase:          "discover",
			TotalCompanies: 3,
			StartedAt:      time.Now().Add(-5 * time.Second),
			UpdatedAt:      time.Now(),
			Companies: []synthesis.CompanyProgress{
				{Name: "Anthropic", Status: "resolved", Vendor: "greenhouse"},
				{Name: "Stripe", Status: "resolved", Vendor: "greenhouse", JobsFound: 578},
				{Name: "Acme", Status: "unresolved", Error: "no ATS board found"},
			},
		},
		started: true,
	}

	out := m.View()

	for _, want := range []string{"roster watch", "Anthropic", "Stripe", "Acme", "578", "no ATS board found"} {
		if !strings.Contains(out, want) {
			t.Errorf("View() output missing expected substring %q\n--- full output ---\n%s", want, out)
		}
	}
}

func TestViewBeforeRosterStarted(t *testing.T) {
	th := theme.NewTheme("catppuccin-mocha")
	m := model{th: th, started: false}
	out := m.View()
	if !strings.Contains(out, "Waiting for a roster run") {
		t.Errorf("expected a waiting message before any telemetry arrives, got:\n%s", out)
	}
}
