package main

import (
	"strings"
	"testing"
)

func TestParseUsagePage(t *testing.T) {
	page := `<html><script>window.__STATE__ = {"usage":{"rolling":{"percent":12.5,"reset_in_sec":600},"weekly":{"percent":34,"reset_in_sec":7200},"monthly":{"percent":8,"reset_in_sec":86400}}}</script></html>`
	usage, err := parseUsagePage(page)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Rolling.Percent != 12.5 || usage.Rolling.ResetInSec != 600 {
		t.Errorf("unexpected rolling meter: %+v", usage.Rolling)
	}
	if usage.Weekly.Percent != 34 || usage.Monthly.ResetInSec != 86400 {
		t.Errorf("unexpected meters: weekly=%+v monthly=%+v", usage.Weekly, usage.Monthly)
	}
}

func TestParseUsagePageCamelCaseFields(t *testing.T) {
	page := `{"rolling5h":{"usagePercent":19.5,"resetInSec":60},"weekly":{"usagePercent":20,"resetInSec":120},"monthly":{"usagePercent":1,"resetInSec":180}}`
	usage, err := parseUsagePage(page)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Rolling.Percent != 19.5 || usage.Rolling.ResetInSec != 60 {
		t.Errorf("unexpected rolling meter: %+v", usage.Rolling)
	}
}

func TestParseUsagePageEscapedScriptState(t *testing.T) {
	page := `<script>self.__next_f.push([1,"{\"rolling\":{\"percent\":2,\"reset_in_sec\":60},\"weekly\":{\"percent\":3,\"reset_in_sec\":120},\"monthly\":{\"percent\":4,\"reset_in_sec\":180}}"])</script>`
	usage, err := parseUsagePage(page)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Rolling.Percent != 2 || usage.Monthly.Percent != 4 {
		t.Errorf("unexpected usage: %+v", usage)
	}
}

func TestParseUsagePageRejectsMissingMeters(t *testing.T) {
	if _, err := parseUsagePage(`{"rolling":{"percent":1,"reset_in_sec":3}}`); err == nil {
		t.Fatal("expected missing meter error")
	}
}

func TestNormalizeCookie(t *testing.T) {
	if got := normalizeCookie("secret"); got != "auth=secret" {
		t.Errorf("normalizeCookie(secret) = %q", got)
	}
	header := "auth=secret; other=value"
	if got := normalizeCookie(header); got != header {
		t.Errorf("normalizeCookie(header) = %q", got)
	}
	if got := normalizeCookie("secret=="); got != "auth=secret==" {
		t.Errorf("normalizeCookie(padded value) = %q", got)
	}
	if got := normalizeNamedCookie("session", "__Host-console_session"); got != "__Host-console_session=session" {
		t.Errorf("normalizeNamedCookie() = %q", got)
	}
}

func TestUsageBar(t *testing.T) {
	for _, test := range []struct {
		percent float64
		filled  int
	}{{0, 0}, {1, 1}, {50, 20}, {100, 40}, {150, 40}, {-1, 0}} {
		got := strings.Count(usageBar(test.percent, 40), "█")
		if got != test.filled {
			t.Errorf("usageBar(%v) has %d filled blocks, want %d", test.percent, got, test.filled)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	for seconds, want := range map[int64]string{
		0:     "0 minutes",
		3600:  "1 hour 0 minutes",
		90061: "1 day 1 hour",
	} {
		if got := formatDuration(seconds); got != want {
			t.Errorf("formatDuration(%d) = %q, want %q", seconds, got, want)
		}
	}
}
