# AI gateway technical spike

## Purpose

Measure one plan request followed by concurrent notes and slides requests using the existing OpenAI-compatible transport. The harness reports time to first generated text, elapsed time, response size, status, and transport error code. It never prints prompts, API keys, or response contents.

The harness sends three real provider requests and may incur usage charges. It requires an explicit opt-in and caps each request at 145 seconds to model the Supabase Free wall-clock budget with a small margin.

## Run locally

Use PowerShell in the project directory and set credentials in the current process only:

```powershell
$env:SMARTUSTAZ_SPIKE_BASE = 'https://your-provider.example/v1'
$env:SMARTUSTAZ_SPIKE_KEY = '<provider-key>'
$env:SMARTUSTAZ_SPIKE_MODEL = '<available-model-id>'
$env:SMARTUSTAZ_SPIKE_ALLOW_CHARGED_REQUESTS = 'YES'
npm run spike:ai-gateway
```

The key is read from the process environment and is not written by the harness. Close the shell when finished to discard these variables. Set `SMARTUSTAZ_SPIKE_STREAM=false` to use non-streaming JSON. A lower per-request timeout can be selected with `SMARTUSTAZ_SPIKE_TIMEOUT_MS`.

## Interpretation and go/no-go

- A request that takes more than 145 seconds is not a safe fit for a synchronous request on the Supabase Free plan.
- The current Supabase hosted limits list 150 seconds maximum wall-clock time on Free, 400 seconds on paid plans, and a 150-second request idle timeout. Each section is a separate provider request in the current app, so record timings per section; do not assume the whole three-section workflow has one server-side budget.
- Streaming may keep a response active only while data is actually forwarded. The local harness measures provider response gaps, not Supabase gateway behavior or Edge Function overhead.
- A passing local run is a prerequisite, not proof that an Edge Function can stream the same request. The deployment spike must also call the function through the hosted gateway and record first byte, stream gaps, total time, cancellation, and provider error mapping.
- If any single section exceeds the chosen plan's wall-clock budget or has an idle gap near 150 seconds, use short-lived job creation plus a worker/queue and status polling rather than one long synchronous function.

## Current status

Not executed: no provider credentials, selected production model, or Supabase test project are available in the workspace. No external requests have been made. The measurement harness is ready for an operator-run test after the provider, model, and spending limit are selected.

References: [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits), [Edge Functions background tasks](https://supabase.com/docs/guides/functions/background-tasks).
