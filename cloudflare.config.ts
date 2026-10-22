import { bindings, defineConfig } from "cf/config";

// `cf dev` runs in development mode; PUBLIC_URL must match the port pinned in vite.config.ts.
// Worker Previews (`cf previews deploy`) get their own KV so branch builds never touch production grants.
export default defineConfig(({ mode, isPreview }) => ({
	accountId: "d93c650f72e597f96785abba389b0ce4",
	worker: {
		name: "garmin-mcp",
		compatibilityDate: "2026-10-21",
		compatibilityFlags: [
			"nodejs_compat",
			"global_fetch_strictly_public",
		],
		entrypoint: "src/index.ts",
		workersDev: true,
		previewUrls: false,
		observability: {
			enabled: true,
			logs: {
				enabled: true,
				invocationLogs: false,
			},
			traces: {
				enabled: true,
				headSamplingRate: 0.01,
			},
		},
		env: {
			PUBLIC_URL: bindings.text(
				mode === "development" ? "http://localhost:5173" : "https://garmin-mcp.aranlucas.workers.dev",
			),
			OAUTH_KV: bindings.kv({
				id: isPreview ? "a7e7f5ddb41041fdaa2a579d5547b963" : "799457c018b64f86a7b950b907a7118c",
			}),
		},
	},
}));
