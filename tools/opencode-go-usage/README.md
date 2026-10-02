# opencode-go-usage

A small Go CLI that displays OpenCode Go plan usage from the authenticated
OpenCode workspace dashboard. OpenCode does not currently provide a public Go
usage API, so the utility reads the dashboard page's embedded usage data.

## Build

Requires Go 1.21+ and, for automatic Firefox cookie extraction, the `sqlite3`
command-line program.

```sh
cd tools/opencode-go-usage
go build -o opencode-go-usage .
```

## Usage

```sh
# Set the workspace ID once, or pass -workspace each time.
export OPENCODE_WORKSPACE=wrk_...
./opencode-go-usage

# Machine-readable output
./opencode-go-usage -json

# List workspace IDs available in the current session
./opencode-go-usage -list-workspaces

# Supply a cookie directly, or read it from a private file
./opencode-go-usage -workspace wrk_... -cookie 'auth=...'
./opencode-go-usage -workspace wrk_... -cookie-file ~/.config/opencode-go-usage/cookie

# If your account uses the console session cookie as well
OPENCODE_COOKIE='auth=...' OPENCODE_CONSOLE_COOKIE='...' ./opencode-go-usage -workspace wrk_...

# Use a particular Firefox profile database
./opencode-go-usage -workspace wrk_... -db ~/Library/Application\ Support/Firefox/Profiles/example.default-release/cookies.sqlite
```

The command looks for a signed-in Firefox profile on macOS or Linux if no cookie
is supplied. `-cookie` also accepts a raw session-cookie value; a value without
`=` is sent as the `auth` cookie. Alternatively, set `OPENCODE_COOKIE`.

The session cookie grants access to the account. Avoid sharing it or committing
cookie files. If OpenCode changes its dashboard page structure, usage parsing
may need an update.
