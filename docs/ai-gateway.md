# AI generation gateway

`supabase/functions/ai-generate` is the server-side prototype for the centralized AI API. The browser routes generation, expansion, and template analysis through it when Supabase is configured. It is not deployed or production-validated.

## Request contract

Send an authenticated `POST` to the Supabase Edge Function with a JSON body:

```json
{
  "operationType": "generation",
  "idempotencyKey": "a-client-generated-random-key",
  "prompt": "The complete prompt assembled by the application",
  "maxOutputTokens": 3500
}
```

`operationType` is `generation`, `expansion`, or `template_analysis`. Keys must be 16–128 ASCII letters, digits, `_`, or `-`. A repeated key returns `409 duplicate_request`; an intentional retry that may incur provider cost must use a new key. The response body streams the provider's SSE or JSON response. `X-Generation-Job-Id` identifies the recorded job.

## Server secrets

Configure these only in the Supabase Edge Function environment; never in browser storage or frontend files:

- `AI_API_BASE`: HTTPS base URL for an OpenAI-compatible Chat Completions API, without `/chat/completions`.
- `AI_API_KEY`: provider credential.
- `AI_MODEL`: centrally selected model identifier.
- `AI_GENERATION_ENABLED`: explicit kill switch; the function serves requests only when set to the exact string `true`.
- `APP_ALLOWED_ORIGIN`: exact HTTPS browser origin; requests from other origins and requests without the configured origin are rejected.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase runtime credentials. The service-role key is used only to reserve and update jobs.

The function validates the bearer token with Supabase Auth, accepts no client-supplied provider URL/key/model, enforces a 64 KiB request cap and 40,000-character prompt cap, limits response bytes to 1 MiB and output to 8,192 tokens, and aborts the upstream call after 140 seconds. The database reservation serializes requests per user, allows at most two active jobs, and allows at most 20 jobs in any rolling 24-hour window. Failed and cancelled attempts count toward the quota to prevent repeated paid retries.

The configured `APP_ALLOWED_ORIGIN` must match the browser origin exactly (for GitHub Pages, the origin excludes the `/SmartUstaz/` path). Configure it before enabling AI. The gateway also requires a valid bearer token and never accepts browser-supplied provider configuration.

## Known boundaries

- The function records job status but does not save generated content into `documents`; persistence and partial bundle orchestration remain later integration work.
- When valid Supabase configuration is present, the browser sends generation, expansion, and template-analysis requests to this endpoint with the current Auth bearer token; it does not fall back to the user-configured provider if the gateway fails. With blank configuration, the original direct-provider mode remains active for baseline compatibility.
- The browser's API test sends a real short generation request in gateway mode and consumes one job from the quota after an explicit confirmation.
- The 20-job quota and timeout are prototype safety defaults, not approved pilot budgets. Revisit them after cost and latency measurements.
- Provider compatibility, actual streaming, job cleanup under platform termination, and RLS/database behavior require local Supabase tests and a real provider test. Neither is available in the current environment.
