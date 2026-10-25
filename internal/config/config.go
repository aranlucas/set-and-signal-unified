// Package config parses environment variables into a Config, mirroring the
// upstream server.js environment block (PORT, DATA_DIR, RP_ID, ORIGIN, ...).
package config

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Config carries every runtime setting the server needs. Field names map 1:1
// to upstream server.js variables (lines 13–33).
type Config struct {
	Port, DataDir, RPID, Origin, RPName string
	// PublicURL is the externally reachable base URL of this API (no trailing
	// slash). Used as the OAuth issuer and MCP resource origin. Defaults to Origin.
	PublicURL                      string
	AdminUIDs                      []string
	InviteOnly                     bool
	SessionDays                    int
	OpenRouterKey, OpenRouterModel string
	DBPath                         string
	ConvexURL                      string
	GarminIssuer, GarminResource   string

	// OIDC federation for the MCP authorization server + web login.
	GoogleClientID, GoogleClientSecret                      string
	GitHubClientID, GitHubClientSecret                      string
	AppleClientID, AppleTeamID, AppleKeyID, ApplePrivateKey string
}

var inviteTruthy = regexp.MustCompile(`(?i)^(1|true|yes|on)$`)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load reads configuration from the process environment with upstream defaults.
func Load() Config {
	dataDir := env("DATA_DIR", "/data")

	sessionDays := 90
	if n, err := strconv.Atoi(env("SESSION_DAYS", "")); err == nil && n >= 1 {
		sessionDays = n
	} else if err == nil {
		sessionDays = 1 // clamp ≥ 1, matching Math.max(1, ...) upstream
	}

	adminUIDs := []string{}
	for s := range strings.SplitSeq(os.Getenv("ADMIN_UIDS"), ",") {
		if s = strings.TrimSpace(s); s != "" {
			adminUIDs = append(adminUIDs, s)
		}
	}

	origin := env("ORIGIN", "http://localhost:8080")
	return Config{
		ConvexURL:       os.Getenv("CONVEX_URL"),
		GarminIssuer:    env("GARMIN_AUTH_ISSUER", "https://auth.aranlucas.workers.dev/api/auth"),
		GarminResource:  env("GARMIN_MCP_RESOURCE", "https://garmin-mcp.aranlucas.workers.dev/mcp"),
		Port:            env("PORT", "3000"),
		DataDir:         dataDir,
		DBPath:          env("DB_PATH", filepath.Join(dataDir, "opengym.db")),
		RPID:            env("RP_ID", "localhost"),
		Origin:          origin,
		PublicURL:       strings.TrimRight(env("PUBLIC_URL", origin), "/"),
		RPName:          env("RP_NAME", "Set & Signal"),
		AdminUIDs:       adminUIDs,
		InviteOnly:      inviteTruthy.MatchString(os.Getenv("INVITE_ONLY")),
		SessionDays:     sessionDays,
		OpenRouterKey:   os.Getenv("OPENROUTER_API_KEY"),
		OpenRouterModel: env("OPENROUTER_MODEL", "openrouter/free"),

		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		GitHubClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		AppleClientID:      os.Getenv("APPLE_CLIENT_ID"),
		AppleTeamID:        os.Getenv("APPLE_TEAM_ID"),
		AppleKeyID:         os.Getenv("APPLE_KEY_ID"),
		ApplePrivateKey:    os.Getenv("APPLE_PRIVATE_KEY"),
	}
}
