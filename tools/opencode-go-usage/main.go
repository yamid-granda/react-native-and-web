package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const dashboardURL = "https://opencode.ai"

var workspaceIDPattern = regexp.MustCompile(`^wrk_[A-Za-z0-9_-]+$`)

type Window struct {
	Percent    float64 `json:"percent"`
	ResetInSec int64   `json:"reset_in_sec"`
	Status     string  `json:"status"`
}

type Usage struct {
	Rolling   Window    `json:"rolling"`
	Weekly    Window    `json:"weekly"`
	Monthly   Window    `json:"monthly"`
	Plan      string    `json:"plan"`
	FetchedAt time.Time `json:"fetched_at"`
}

type options struct {
	workspace     string
	cookie         string
	cookieFile     string
	database       string
	jsonOutput     bool
	listWorkspaces bool
}

func main() {
	var opts options
	flag.StringVar(&opts.workspace, "workspace", os.Getenv("OPENCODE_WORKSPACE"), "OpenCode workspace ID (or set OPENCODE_WORKSPACE)")
	flag.StringVar(&opts.cookie, "cookie", "", "OpenCode session cookie value or Cookie header")
	flag.StringVar(&opts.cookieFile, "cookie-file", "", "read the session cookie from a file")
	flag.StringVar(&opts.database, "db", "", "Firefox cookies.sqlite path (overrides auto-detection)")
	flag.BoolVar(&opts.jsonOutput, "json", false, "write usage as JSON")
	flag.BoolVar(&opts.listWorkspaces, "list-workspaces", false, "list workspace IDs available to this session")
	flag.Parse()

	if err := run(context.Background(), opts, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "opencode-go-usage:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, opts options, out io.Writer) error {
	cookie, err := resolveCookie(opts)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 20 * time.Second}

	if opts.listWorkspaces {
		ids, err := listWorkspaces(ctx, client, cookie)
		if err != nil {
			return err
		}
		for _, id := range ids {
			fmt.Fprintln(out, id)
		}
		return nil
	}
	if opts.workspace == "" {
		return errors.New("workspace ID required; use -workspace or OPENCODE_WORKSPACE (try -list-workspaces)")
	}
	if !workspaceIDPattern.MatchString(opts.workspace) {
		return errors.New("invalid workspace ID; expected an ID beginning with wrk_")
	}

	usage, err := fetchUsage(ctx, client, cookie, opts.workspace)
	if err != nil {
		return err
	}
	if opts.jsonOutput {
		encoder := json.NewEncoder(out)
		encoder.SetIndent("", "  ")
		return encoder.Encode(usage)
	}
	printUsage(out, usage)
	return nil
}

func resolveCookie(opts options) (string, error) {
	var cookie string
	if value := strings.TrimSpace(opts.cookie); value != "" {
		cookie = normalizeCookie(value)
	} else if path := strings.TrimSpace(opts.cookieFile); path != "" {
		data, err := os.ReadFile(expandHome(path))
		if err != nil {
			return "", fmt.Errorf("read cookie file: %w", err)
		}
		value = strings.TrimSpace(string(data))
		if value == "" {
			return "", errors.New("cookie file is empty")
		}
		cookie = normalizeCookie(value)
	} else if value := strings.TrimSpace(os.Getenv("OPENCODE_COOKIE")); value != "" {
		cookie = normalizeCookie(value)
	} else if consoleCookie := strings.TrimSpace(os.Getenv("OPENCODE_CONSOLE_COOKIE")); consoleCookie != "" {
		cookie = normalizeNamedCookie(consoleCookie, "__Host-console_session")
	} else {
		var err error
		cookie, err = firefoxCookie(opts.database)
		if err != nil {
			return "", err
		}
	}
	if consoleCookie := strings.TrimSpace(os.Getenv("OPENCODE_CONSOLE_COOKIE")); consoleCookie != "" && !strings.Contains(cookie, "__Host-console_session=") {
		if cookie != "" {
			cookie += "; "
		}
		cookie += normalizeNamedCookie(consoleCookie, "__Host-console_session")
	}
	return cookie, nil
}

func normalizeCookie(value string) string {
	if strings.Contains(value, ";") || strings.HasPrefix(value, "auth=") || strings.HasPrefix(value, "__Host-console_session=") {
		return value
	}
	return "auth=" + value
}

func normalizeNamedCookie(value, name string) string {
	if strings.HasPrefix(value, name+"=") || strings.Contains(value, ";") {
		return value
	}
	return name + "=" + value
}

func firefoxCookie(database string) (string, error) {
	if database == "" {
		var err error
		database, err = findFirefoxDatabase()
		if err != nil {
			return "", err
		}
	}
	database = expandHome(database)
	if _, err := os.Stat(database); err != nil {
		return "", fmt.Errorf("Firefox cookie database: %w", err)
	}
	sql := `SELECT name || '=' || value FROM moz_cookies WHERE host IN ('opencode.ai', '.opencode.ai') AND name IN ('auth', '__Host-console_session') ORDER BY CASE name WHEN '__Host-console_session' THEN 0 ELSE 1 END;`
	command := exec.Command("sqlite3", "-readonly", database, sql)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", errors.New("sqlite3 is required to read Firefox cookies; install it or pass -cookie / -cookie-file")
		}
		return "", fmt.Errorf("read Firefox cookies with sqlite3: %s", strings.TrimSpace(stderr.String()))
	}
	values := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(values) == 0 || values[0] == "" {
		return "", errors.New("no OpenCode session cookie found in Firefox; sign in at opencode.ai or pass -cookie / -cookie-file")
	}
	return strings.Join(values, "; "), nil
}

func findFirefoxDatabase() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	var roots []string
	switch runtime.GOOS {
	case "darwin":
		roots = []string{filepath.Join(home, "Library", "Application Support", "Firefox")}
	case "linux":
		roots = []string{
			filepath.Join(home, ".mozilla", "firefox"),
			filepath.Join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
		}
	default:
		return "", errors.New("automatic Firefox cookie discovery is supported on macOS and Linux; pass -cookie, -cookie-file, or -db")
	}

	for _, root := range roots {
		profiles := firefoxProfiles(root)
		for _, profile := range profiles {
			candidate := filepath.Join(profile, "cookies.sqlite")
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
		}
		matches, _ := filepath.Glob(filepath.Join(root, "*.default*", "cookies.sqlite"))
		if len(matches) > 0 {
			sort.Strings(matches)
			return matches[0], nil
		}
	}
	return "", errors.New("Firefox profile not found; pass -cookie, -cookie-file, or -db")
}

func firefoxProfiles(root string) []string {
	data, err := os.ReadFile(filepath.Join(root, "profiles.ini"))
	if err != nil {
		return nil
	}
	var paths []string
	section := map[string]string{}
	flush := func() {
		path := section["Path"]
		if path == "" {
			return
		}
		if section["IsRelative"] == "1" {
			path = filepath.Join(root, path)
		}
		paths = append(paths, path)
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			flush()
			section = map[string]string{}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if ok {
			section[key] = value
		}
	}
	flush()
	return paths
}

func fetchUsage(ctx context.Context, client *http.Client, cookie, workspace string) (Usage, error) {
	url := dashboardURL + "/workspace/" + workspace + "/go"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Usage{}, err
	}
	request.Header.Set("Cookie", cookie)
	request.Header.Set("User-Agent", "opencode-go-usage/1.0")
	response, err := client.Do(request)
	if err != nil {
		return Usage{}, fmt.Errorf("fetch OpenCode Go usage: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Usage{}, fmt.Errorf("OpenCode returned %s", response.Status)
	}
	if strings.Contains(strings.ToLower(response.Request.URL.Path), "sign-in") || strings.Contains(strings.ToLower(response.Request.URL.Path), "login") {
		return Usage{}, errors.New("OpenCode session expired or invalid; sign in again and refresh the cookie")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return Usage{}, fmt.Errorf("read OpenCode response: %w", err)
	}
	usage, err := parseUsagePage(string(body))
	if err != nil {
		return Usage{}, err
	}
	usage.Plan = "Go"
	usage.FetchedAt = time.Now().UTC()
	return usage, nil
}

var workspacePattern = regexp.MustCompile(`wrk_[A-Za-z0-9_-]+`)

func listWorkspaces(ctx context.Context, client *http.Client, cookie string) ([]string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, dashboardURL+"/workspace", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Cookie", cookie)
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("list OpenCode workspaces: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("OpenCode returned %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	ids := workspacePattern.FindAllString(string(body), -1)
	if len(ids) == 0 {
		return nil, errors.New("no workspace IDs found; check the session cookie")
	}
	seen := map[string]bool{}
	unique := ids[:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	sort.Strings(unique)
	return unique, nil
}

func parseUsagePage(page string) (Usage, error) {
	page = html.UnescapeString(page)
	for _, candidate := range jsonCandidates(page) {
		var value any
		if json.Unmarshal([]byte(candidate), &value) != nil {
			continue
		}
		if usage, ok := findUsage(value); ok {
			return usage, nil
		}
	}
	return Usage{}, errors.New("could not find usage meters in OpenCode page; the dashboard may have changed")
}

// jsonCandidates returns balanced JSON objects embedded in scripts or inline state assignments.
func jsonCandidates(page string) []string {
	candidates := balancedJSONObjects(page)
	for _, quoted := range quotedStringPattern.FindAllString(page, -1) {
		decoded, err := strconv.Unquote(quoted)
		if err == nil {
			candidates = append(candidates, balancedJSONObjects(decoded)...)
		}
	}
	return candidates
}

var quotedStringPattern = regexp.MustCompile(`"(?:\\.|[^"\\])*"`)

func balancedJSONObjects(page string) []string {
	var candidates []string
	start, depth := -1, 0
	inString, escaped := false, false
	for i, char := range page {
		if inString {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
				if depth == 0 && start >= 0 {
					candidates = append(candidates, page[start:i+1])
					start = -1
				}
			}
		}
	}
	return candidates
}

func findUsage(value any) (Usage, bool) {
	root, ok := value.(map[string]any)
	if !ok {
		return Usage{}, false
	}
	var usage Usage
	found := map[string]bool{}
	var walk func(map[string]any)
	walk = func(object map[string]any) {
		for key, value := range object {
			name := strings.ToLower(strings.ReplaceAll(key, "_", ""))
			windowName := ""
			switch {
			case strings.Contains(name, "rolling"):
				windowName = "rolling"
			case strings.Contains(name, "weekly") || name == "week":
				windowName = "weekly"
			case strings.Contains(name, "monthly") || name == "month":
				windowName = "monthly"
			}
			if windowName != "" {
				if meter, ok := findMeter(value); ok {
					switch windowName {
					case "rolling":
						usage.Rolling, found[windowName] = meter, true
					case "weekly":
						usage.Weekly, found[windowName] = meter, true
					case "monthly":
						usage.Monthly, found[windowName] = meter, true
					}
				}
			}
			switch child := value.(type) {
			case map[string]any:
				walk(child)
			case []any:
				for _, item := range child {
					if nested, ok := item.(map[string]any); ok {
						walk(nested)
					}
				}
			}
		}
	}
	walk(root)
	return usage, found["rolling"] && found["weekly"] && found["monthly"]
}

func findMeter(value any) (Window, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return Window{}, false
	}
	percent, hasPercent := numberField(object, "percent", "usagePercent", "usedPercent")
	reset, hasReset := numberField(object, "reset_in_sec", "resetInSec", "resetInSeconds")
	if hasPercent {
		status, _ := object["status"].(string)
		if status == "" {
			status = "ok"
		}
		return Window{Percent: percent, ResetInSec: int64(reset), Status: status}, hasReset
	}
	for _, child := range object {
		if meter, ok := findMeter(child); ok {
			return meter, true
		}
	}
	return Window{}, false
}

func numberField(object map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		if value, ok := object[key].(float64); ok {
			return value, true
		}
	}
	return 0, false
}

func printUsage(out io.Writer, usage Usage) {
	fmt.Fprintln(out, "OpenCode Go Usage (Go plan)")
	fmt.Fprintf(out, "\n  Rolling: %5.1f%% used  (resets in %s)\n", usage.Rolling.Percent, formatDuration(usage.Rolling.ResetInSec))
	fmt.Fprintf(out, "  Weekly:  %5.1f%% used  (resets in %s)\n", usage.Weekly.Percent, formatDuration(usage.Weekly.ResetInSec))
	fmt.Fprintf(out, "  Monthly: %5.1f%% used  (resets in %s)\n", usage.Monthly.Percent, formatDuration(usage.Monthly.ResetInSec))
	fmt.Fprintln(out)
	color := isTerminal(out)
	for _, item := range []struct {
		name string
		meter Window
	}{{"Rolling", usage.Rolling}, {"Weekly", usage.Weekly}, {"Monthly", usage.Monthly}} {
		bar := usageBar(item.meter.Percent, 40)
		if color {
			bar = colorBar(bar, item.meter.Percent)
		}
		fmt.Fprintf(out, "  %-7s %s %5.1f%%\n", item.name, bar, item.meter.Percent)
	}
}

func usageBar(percent float64, width int) string {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	filled := int(percent * float64(width) / 100)
	if percent > 0 && filled == 0 {
		filled = 1
	}
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}

func colorBar(bar string, percent float64) string {
	color := "32"
	if percent >= 75 {
		color = "31"
	} else if percent >= 50 {
		color = "33"
	}
	return "\x1b[" + color + "m" + bar + "\x1b[0m"
}

func isTerminal(out io.Writer) bool {
	file, ok := out.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0 && os.Getenv("NO_COLOR") == ""
}

func formatDuration(seconds int64) string {
	if seconds < 0 {
		seconds = 0
	}
	remaining := time.Duration(seconds) * time.Second
	days := int(remaining / (24 * time.Hour))
	remaining %= 24 * time.Hour
	hours := int(remaining / time.Hour)
	remaining %= time.Hour
	minutes := int(remaining / time.Minute)
	if days > 0 {
		return fmt.Sprintf("%d %s %d %s", days, plural(days, "day"), hours, plural(hours, "hour"))
	}
	if hours > 0 {
		return fmt.Sprintf("%d %s %d %s", hours, plural(hours, "hour"), minutes, plural(minutes, "minute"))
	}
	return fmt.Sprintf("%d %s", minutes, plural(minutes, "minute"))
}

func plural(count int, unit string) string {
	if count == 1 {
		return unit
	}
	return unit + "s"
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(path, "~"), string(filepath.Separator)))
		}
	}
	return path
}
