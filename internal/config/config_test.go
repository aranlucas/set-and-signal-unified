package config

import (
	"reflect"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("RP_ID", "")
	t.Setenv("ORIGIN", "")
	t.Setenv("PUBLIC_URL", "")
	t.Setenv("RP_NAME", "")
	t.Setenv("ADMIN_UIDS", "")
	t.Setenv("INVITE_ONLY", "")
	t.Setenv("SESSION_DAYS", "")
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_MODEL", "")
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	t.Setenv("GITHUB_CLIENT_ID", "")
	t.Setenv("GITHUB_CLIENT_SECRET", "")
	t.Setenv("APPLE_CLIENT_ID", "")
	t.Setenv("APPLE_TEAM_ID", "")
	t.Setenv("APPLE_KEY_ID", "")
	t.Setenv("APPLE_PRIVATE_KEY", "")

	got := Load()
	want := Config{
		Port:            "3000",
		DataDir:         "/data",
		DBPath:          "/data/opengym.db",
		RPID:            "localhost",
		Origin:          "http://localhost:8080",
		PublicURL:       "http://localhost:8080",
		RPName:          "Set & Signal",
		AdminUIDs:       []string{},
		InviteOnly:      false,
		SessionDays:     90,
		OpenRouterKey:   "",
		OpenRouterModel: "openrouter/free",
		GarminIssuer:    "https://auth.aranlucas.workers.dev/api/auth",
		GarminResource:  "https://garmin-mcp.aranlucas.workers.dev/mcp",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("PORT", "8081")
	t.Setenv("DATA_DIR", "/tmp/og")
	t.Setenv("RP_ID", "gym.example.com")
	t.Setenv("ORIGIN", "https://gym.example.com")
	t.Setenv("RP_NAME", "MyGym")
	t.Setenv("SESSION_DAYS", "7")
	t.Setenv("OPENROUTER_API_KEY", "sk-test")
	t.Setenv("OPENROUTER_MODEL", "openai/gpt-4o")

	got := Load()
	if got.Port != "8081" || got.DataDir != "/tmp/og" || got.RPID != "gym.example.com" ||
		got.Origin != "https://gym.example.com" || got.PublicURL != "https://gym.example.com" ||
		got.RPName != "MyGym" ||
		got.SessionDays != 7 || got.OpenRouterKey != "sk-test" || got.OpenRouterModel != "openai/gpt-4o" {
		t.Fatalf("unexpected config: %+v", got)
	}
}

func TestSessionDaysClamp(t *testing.T) {
	cases := []struct {
		env  string
		want int
	}{
		{"0", 1},
		{"-5", 1},
		{"abc", 90},
	}
	for _, c := range cases {
		t.Setenv("SESSION_DAYS", c.env)
		if got := Load().SessionDays; got != c.want {
			t.Errorf("SESSION_DAYS=%q → %d, want %d", c.env, got, c.want)
		}
	}
}

func TestInviteOnly(t *testing.T) {
	truthy := []string{"1", "true", "TRUE", "Yes", "ON", "on"}
	for _, v := range truthy {
		t.Setenv("INVITE_ONLY", v)
		if !Load().InviteOnly {
			t.Errorf("INVITE_ONLY=%q should be true", v)
		}
	}
	falsy := []string{"", "0", "false", "no", "off", "yes please"}
	for _, v := range falsy {
		t.Setenv("INVITE_ONLY", v)
		if Load().InviteOnly {
			t.Errorf("INVITE_ONLY=%q should be false", v)
		}
	}
}

func TestAdminUIDs(t *testing.T) {
	t.Setenv("ADMIN_UIDS", " a , b,,c  ,")
	got := Load().AdminUIDs
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("AdminUIDs = %q, want %q", got, want)
	}
}
