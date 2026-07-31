import { sveltekit } from "@sveltejs/kit/vite";
import { eveSvelteKit } from "eve/sveltekit";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load all env vars (no prefix filter) so server-side secrets are available
  // to the dev proxies without ever being exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), "");
  // EVE and the server-only agent stores read process.env. Vite loads .env
  // files into its own map, so explicitly bridge only the agent's server-side
  // inputs during local development. Vite does not expose these to clients.
  for (const name of [
    "AGENT_WALLET_MASTER_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "DEEPSEEK_API_KEY",
    "LLM_PROFILE_ENCRYPTION_KEY",
    "LLM_PROFILE_ENCRYPTION_KEY_PREVIOUS",
    "NEXT_PUBLIC_PRIVY_APP_ID",
    "PUBLIC_PRIVY_APP_ID",
    "PUBLIC_SOLANA_RPC_URL",
    "SOLANA_RPC_URL",
    "TOKENS_XYZ_API_KEY",
    "VITE_PRIVY_APP_ID",
  ]) {
    if (!process.env[name] && env[name]) process.env[name] = env[name];
  }
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim();
  const tokensXyzKey = env.TOKENS_XYZ_API_KEY?.trim();
  // Windows/local: EVE's Node evaluator rejects extensionless agent imports
  // that Bun resolves. Set SKIP_EVE=1 to boot the terminal without the agent
  // runtime (prod/Vercel still uses EVE).
  const skipEve = env.SKIP_EVE === "1" || process.env.SKIP_EVE === "1";

  return {
    envPrefix: ["VITE_", "PUBLIC_", "NEXT_PUBLIC_"],
    // configureVercelJson: false — eveSvelteKit still writes legacy
    // experimentalServices, which Vercel no longer routes for dynamic
    // /eve/v1/session/:id (+ stream) paths (platform NOT_FOUND). Stable
    // `services` live in vercel.json and must not be overwritten on build.
    plugins: [
      ...(skipEve ? [] : [eveSvelteKit({ configureVercelJson: false })]),
      sveltekit(),
    ],
    ssr: { noExternal: ["@harness-trade/ui"] },
    server: {
      proxy: {
        // DeepSeek — key injected server-side, never in the client bundle.
        "/deepseek": {
          target: "https://api.deepseek.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/deepseek/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (deepseekKey) {
                proxyReq.setHeader("Authorization", `Bearer ${deepseekKey}`);
              }
            });
          },
        },
        // Yahoo Finance v8 chart — keyless macro/market quotes (CORS workaround).
        "/yahoo": {
          target: "https://query1.finance.yahoo.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/yahoo/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("user-agent", "Mozilla/5.0");
            });
          },
        },
        // GDELT 2.0 — keyless geopolitical/market event + news stream.
        "/gdelt": {
          target: "https://api.gdeltproject.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gdelt/, ""),
        },
        // Jupiter swap API (keyless lite tier) for SOL→USDC conversion.
        "/jupiter": {
          target: "https://lite-api.jup.ag",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jupiter/, ""),
        },
        // tokens.xyz asset catalog — API key injected server-side only.
        "/tokensxyz": {
          target: "https://api.tokens.xyz",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tokensxyz/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (tokensXyzKey) {
                proxyReq.setHeader("x-api-key", tokensXyzKey);
              }
            });
          },
        },
      },
    },
  };
});
