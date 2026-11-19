# Railway infrastructure

[`railway.go`](railway.go) declares the production Set & Signal project: one
Railpack-built Go service and the persistent SQLite volume mounted at `/data`.
Railway-generated domains remain attached but are not managed by the IaC API.
The live `opengym2` production service deploys from `aranlucas/set-and-signal`
on `main`. This repository holds the declaration for a future cutover.

The root [`railpack.json`](../railpack.json) installs Node 24 and pnpm 12.6.0,
uses the Go version from `go.mod`, builds the `web` workspace, and embeds its
output in `./cmd/opengym-api`. The runtime starts `./out` and retains the
`/data` storage path. There is no root Dockerfile, so Railway can use Railpack.

The service and volume retain their original Railway resource addresses so the
declaration can adopt the existing deployment without recreating or detaching
its data. Those names are infrastructure identifiers, not product branding.

## Prerequisites

- Go 1.27.1+ (aligned with the application toolchain)
- A current Railway CLI with Go IaC support (verified with 5.62.1)

The declaration uses the [Railway Go SDK](https://github.com/railwayapp/railway-go-sdk)
in its own Go module. Install dependencies and check it:

```bash
cd .railway
go mod download
go test ./...
go vet ./...
cd ..
```

For trial plans before cutover, use a separate Railway project and a
non-production environment.

`OPENROUTER_API_KEY` uses `railway.Preserve()`: Railway retains the value already stored
in the environment and never writes it to this repository. Before applying the
file to a brand-new Railway project, create that optional variable or remove its
entry if AI suggestions should remain disabled.

The generated `opengym2.up.railway.app` hostname is kept as a compatibility
boundary for existing OAuth clients, passkeys, and bookmarks. Add and verify a
custom domain before changing `domains`, `ORIGIN`, `PUBLIC_URL`, or `RP_ID`
together.

## GitHub Actions

[The Railway workflow](../.github/workflows/railway-config.yml) runs the Go
declaration checks for ready pull requests that change `.railway/` or the
workflow. The check summary shows whether authenticated jobs are enabled.
Dependabot PRs touching those paths require manual review in either mode.

Leave the `RAILWAY_PRODUCTION_ENABLED` Actions repository variable unset during
migration. At a deliberate production cutover, configure the production-scoped
`RAILWAY_TOKEN` Actions secret and set `RAILWAY_PRODUCTION_ENABLED` to `true`.
Trigger a fresh PR run and review the authenticated plan before merging. The
plan fails if authentication fails. Apply on merge requires the pinned plan
artifact. A missing plan, a changed environment, or a different `.railway/`
tree causes apply to fail. Fork PRs continue to run declaration checks only.
The workflow grants the permissions required by the
[Railway Config Action](https://github.com/railwayapp/config), including OIDC
for Railway bot comments when the Railway GitHub App is installed.

Go authoring is currently in beta; see the
[Railway IaC documentation](https://docs.railway.com/infrastructure-as-code).
