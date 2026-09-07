# Gemini semantic provider

The optional Gemini adapter implements the existing semantic-provider interface.
It reads `GEMINI_API_KEY` from the environment and returns only the strict
intermediate representation. It does not receive candidate data or write files.

The CLI uses Gemini only when unresolved content exists and `GEMINI_API_KEY` is
configured. Fully deterministic jobs do not need a key. Without a key, unresolved
content still fails explicitly.

The default model is `gemini-3.7-flash`, matching the repository's Gemini
workflow. Set `GEMINI_MODEL` to select another model supported by the account.
The request timeout defaults to 120 seconds and can be changed with
`GEMINI_TIMEOUT_MS`. Transient rate-limit and service-availability responses
are retried up to three times by default; `GEMINI_MAX_ATTEMPTS` can change this.

Gemini requests include `schemas/job-parser.schema.json` as the structured
response schema. Responses are still parsed as untrusted JSON and validated
locally against the same schema; local validation remains authoritative. Evidence
validation runs afterward through the existing semantic extraction flow.
Authentication, rate-limit, request, timeout, network, malformed-response, and
schema errors are reported with stable `GEMINI_*` categories. The key is never
logged or persisted.

Normal tests use mocked fetch responses and require no network or secret:

```sh
npm run test:gemini-provider
```
