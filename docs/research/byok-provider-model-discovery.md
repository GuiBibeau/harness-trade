# BYOK provider model discovery

Research date: 2026-07-31  
Scope: first-party API and SDK documentation for OpenAI, Anthropic, DeepSeek,
and xAI.

## Recommendation

Discover models server-side with the user's decrypted provider key. Normalize
the provider response into one bounded internal shape, cache it per profile
(never globally), and return only model metadata to the browser. Use discovery
both to validate that a key can authenticate and to show the models that key
can actually access.

Capability discovery is uneven:

- Anthropic returns explicit capability and token-limit metadata.
- xAI's `/v1/language-models` returns modalities, aliases, context/pricing
  fields, and is substantially better than its mixed `/v1/models` route.
- OpenAI and DeepSeek return only basic identity/ownership fields. Their model
  IDs must still be intersected with an app-owned policy for models compatible
  with this agent; the list response alone cannot prove tool, streaming, or
  text-generation support.

## Provider contracts

### OpenAI

- **Endpoint:** `GET https://api.openai.com/v1/models`.
- **Authentication:** `Authorization: Bearer <API key>`. OpenAI also documents
  optional `OpenAI-Organization` and `OpenAI-Project` headers for legacy keys
  that can address multiple organizations/projects.
- **Response:** `{ "object": "list", "data": Model[] }`, where each model has
  `id`, `object: "model"`, Unix `created`, and `owned_by`.
- **Pagination:** none is documented for this endpoint: there are no query
  parameters or cursor fields in the response.
- **Constraint:** the API describes this as basic model information. It does
  not return input/output modalities, tool support, or endpoint compatibility,
  and may include organization-owned/fine-tuned models. Do not present every
  returned ID as automatically agent-compatible.

Sources: [OpenAI List models API reference](https://developers.openai.com/api/reference/resources/models/methods/list),
[OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication).

### Anthropic

- **Endpoint:** `GET https://api.anthropic.com/v1/models`.
- **Authentication:** `x-api-key: <API key>` plus the required
  `anthropic-version` header (the official example uses `2023-06-01`).
- **Response:** `data[]` entries include `id`, `display_name`, `created_at`,
  `type: "model"`, `max_input_tokens`, `max_tokens`, and structured
  `capabilities` (including fields for batch, citations, code execution,
  context management, effort levels, image/PDF input, structured outputs, and
  thinking). The page wrapper contains `first_id`, `last_id`, and `has_more`.
- **Pagination:** cursor-based. `limit` defaults to 20 and accepts 1–1000;
  `after_id` returns the page after an object and `before_id` the page before
  it. More recently released models are listed first. To walk forward, pass
  the previous `last_id` as `after_id` until `has_more` is false.
- **Constraint:** use the returned capabilities rather than parsing model
  names. Bound the number of pages/items even though the documented maximum
  page size is 1000.

Sources: [Anthropic List Models API reference](https://platform.claude.com/docs/en/api/models/list),
[Anthropic API overview and required headers](https://platform.claude.com/docs/en/api/overview),
[Anthropic API-key security guidance](https://platform.claude.com/docs/en/manage-claude/authentication).

### DeepSeek

- **Endpoint:** `GET https://api.deepseek.com/models` (the official API base is
  `https://api.deepseek.com`, with the documented route `/models`).
- **Authentication:** HTTP Bearer authentication:
  `Authorization: Bearer <API key>`.
- **Response:** `{ "object": "list", "data": Model[] }`, where each entry has
  `id`, `object: "model"`, and `owned_by`.
- **Pagination:** none is documented; the route has no documented query
  parameters or cursor fields.
- **Current IDs:** the current first-party response example and pricing page
  list `deepseek-v4-flash` and `deepseek-v4-pro`. DeepSeek's changelog says the
  old `deepseek-chat` and `deepseek-reasoner` names were discontinued on
  2026-07-24, so they should not remain in a current fallback catalog.
- **Constraint:** as with OpenAI, the response has no capability metadata.
  Intersect discovered IDs with an agent-compatible policy and update that
  policy from first-party release documentation.

Sources: [DeepSeek List Models API reference](https://api-docs.deepseek.com/api/list-models/),
[DeepSeek Bearer authentication](https://api-docs.deepseek.com/api/deepseek-api/),
[DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/),
[DeepSeek changelog](https://api-docs.deepseek.com/updates/).

### xAI

- **Preferred endpoint:** `GET https://api.x.ai/v1/language-models`. It lists
  chat and image-understanding models available to the authenticating key.
  Avoid using only `GET /v1/models` for an agent selector because that route is
  a mixed catalog and its documented example includes image-generation models.
- **Authentication:** `Authorization: Bearer <xAI API key>`.
- **Response:** `{ "models": LanguageModel[] }`. Entries include `id`,
  `aliases`, `fingerprint`, Unix `created`, `object: "model"`, `owned_by`,
  `version`, `input_modalities`, `output_modalities`, context/long-context
  fields, and pricing fields. The broader `/v1/models` response is
  `{ "object": "list", "data": Model[] }`.
- **Pagination:** none is documented for either model-list route. Both are
  shown with “No parameters” and have no continuation field.
- **Permissions:** xAI keys are team-bound and can be restricted by endpoint
  and model ACLs. A `403` therefore means the key/team lacks permission (or is
  blocked), not necessarily that the key is malformed; `401` means a missing
  or invalid authorization token. Discovery must preserve that distinction.

Sources: [xAI Models REST reference](https://docs.x.ai/developers/rest-api-reference/inference/models),
[xAI Inference API authentication](https://docs.x.ai/developers/rest-api-reference/inference),
[xAI key ACLs](https://docs.x.ai/developers/rest-api-reference/management/auth),
[xAI error semantics](https://docs.x.ai/developers/debugging).

## Current Grok text model IDs

The current xAI pricing catalog lists these active text API model IDs:

- `grok-4.5`
- `grok-build-0.1`
- `grok-4.3`
- `grok-4.20-multi-agent-0309`
- `grok-4.20-0309-reasoning`
- `grok-4.20-0309-non-reasoning`

This is a dated implementation reference, not a permanent allowlist. Prefer the
IDs and aliases returned by the user's `/v1/language-models` response. xAI
documents that aliases may advance to newer versions, while dated releases are
for consistency.

Do not offer these retired slugs even though xAI currently redirects them:
`grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`,
`grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-4-0709`,
`grok-code-fast-1`, and `grok-3`. They were retired on 2026-05-15 and redirect
to newer models with potentially different reasoning settings and prices.

Sources: [xAI current pricing catalog](https://docs.x.ai/developers/pricing),
[xAI models and alias behavior](https://docs.x.ai/developers/models),
[xAI May 2026 retirement notice](https://docs.x.ai/developers/migration/may-15-retirement),
[Grok 4.5 first-party guide](https://docs.x.ai/developers/grok-4-5).

## TypeScript / Vercel AI SDK integration for xAI

Vercel's official provider is `@ai-sdk/xai`. For per-user BYOK, instantiate it
with the decrypted key instead of using the process-wide default:

```ts
import { createXai } from "@ai-sdk/xai";

const xai = createXai({ apiKey });
const model = xai(modelId);
```

The provider defaults to `https://api.x.ai/v1`, sends the key through the
`Authorization` header, and otherwise falls back to `XAI_API_KEY`. Under AI SDK
7, `xai(modelId)` uses xAI's Responses API by default; use
`xai.chat(modelId)` only when the application specifically requires the legacy
Chat Completions API. xAI's own Grok 4.5 guide also demonstrates
`xai.responses("grok-4.5")`.

Source: [Vercel AI SDK xAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/xai),
[xAI Grok 4.5 JavaScript example](https://docs.x.ai/developers/grok-4-5).

## Implementation and security constraints

1. **Keep the key server-side.** Discovery must be an authenticated server
   operation. OpenAI explicitly says API keys must not be exposed in browsers
   or apps; Anthropic and xAI likewise recommend a secrets manager and regular
   rotation.
2. **Use fixed provider origins.** Do not accept a user-controlled discovery
   URL or `baseURL`; that would turn a decrypted secret into an SSRF/credential
   exfiltration primitive.
3. **Decrypt only around use.** Decrypt immediately before discovery or model
   construction, do not memoize the plaintext provider instance, and release
   references when the request ends. Never include authorization headers,
   provider request objects, or plaintext keys in logs/traces/errors.
4. **Partition caches by profile.** Provider model availability is
   credential/team/project specific. Cache normalized metadata by authenticated
   owner + profile ID (and invalidate it when the key changes); never share one
   user's discovery result with another.
5. **Treat provider data as untrusted.** Schema-validate responses, cap bytes,
   page count, item count, string lengths, and aliases, deduplicate IDs, and
   use a short timeout. Return sanitized errors rather than raw provider
   bodies.
6. **Do not confuse authentication with compatibility.** A successful model
   list validates the credential for that endpoint. It does not guarantee that
   every returned model works with EVE's required generation/tool surface.
   Filter on Anthropic/xAI capabilities and use a maintained compatibility
   policy for OpenAI/DeepSeek.
7. **Validate selection again server-side.** Accept only a model ID from the
   latest bounded discovery result (or an explicit safe fallback) for that
   profile. Do not trust a browser-submitted arbitrary ID.
8. **Handle transient failure without erasing a valid setup.** Distinguish
   invalid credentials (`401`), insufficient permissions (`403`), throttling
   (`429`), and upstream/network failure. A temporary refresh failure should
   preserve the encrypted key and may show a clearly labeled stale cached
   catalog.
9. **Use least-privilege keys where the provider supports it.** xAI can scope
   keys to specific endpoints/models and attach expiry and rate limits.
   Discovery and inference should work with the narrowest permissions required,
   rather than requiring wildcard ACLs.

xAI specifically advises treating API keys like passwords, storing them in
environment/secret-management tools, rotating regularly, and disabling or
deleting a suspected compromised key. Its keys are tied to teams. See
[xAI API security](https://docs.x.ai/developers/faq/security).
