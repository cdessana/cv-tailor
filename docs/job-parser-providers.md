# Job parser semantic providers

The job parser and résumé rewriter make independent provider choices. Configure
job-description extraction with `jobParser.semanticProvider`; keep using
`llm.provider` for résumé generation and rewriting.

```json
{
  "llm": { "provider": "ollama" },
  "jobParser": {
    "semanticProvider": "none",
    "providers": {
      "gemini": {
        "model": "gemini-3.1-flash-lite",
        "timeoutMs": 120000,
        "maxAttempts": 3,
        "batchSize": 3,
        "maxCorrections": 2
      },
      "ollama": {
        "model": "granite4.2:3b-q4_K_S",
        "url": "http://127.0.0.1:11434",
        "contextSize": 16384,
        "timeoutMs": 120000,
        "maxAttempts": 3,
        "batchSize": 3,
        "maxCorrections": 2
      }
    }
  }
}
```

Selection precedence is:

1. `--semantic-provider <gemini|ollama|none>`
2. `JOB_PARSER_PROVIDER`
3. `jobParser.semanticProvider`
4. the built-in `none` default

`gemini` requires `GEMINI_API_KEY`. `ollama` requires the configured local
service and model to be available. `none` is deterministic-only mode: it makes no
semantic-provider request and rejects a job description if deterministic parsing
leaves unresolved blocks. This default ensures that semantic parsing never
transmits a job description until the user explicitly selects a provider.

Provider-specific environment variables override values from the configuration
file. Gemini preserves `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`,
`GEMINI_MAX_ATTEMPTS`, `GEMINI_BATCH_SIZE`, and `GEMINI_MAX_CORRECTIONS`.
Ollama accepts the existing `OLLAMA_MODEL` and `OLLAMA_HOST` variables, plus
job-parser-specific `JOB_PARSER_OLLAMA_*` overrides for its model, host, context
size, timeout, attempt count, batch size, and correction count. Structured
requests disable model thinking and use a 16,384-token context by default.
Override it with `JOB_PARSER_OLLAMA_CONTEXT_SIZE` or
`jobParser.providers.ollama.contextSize` when necessary.

Gemini sends the source job description to Google's Gemini service. Ollama keeps
processing local only when its URL points to a service running on infrastructure
you control. Never select a remote Ollama-compatible endpoint under the
assumption that it is local. Ollama models must reliably support JSON-schema
structured output; smaller models may fail strict extraction or exhaust the
configured correction attempts. No result is accepted merely because a provider
returned it.

The Ollama adapter minimizes that burden by sending only deterministically
unresolved source blocks and requesting a flat provider-facing record format.
The adapter then translates those records into the canonical extraction
contract. For supported LinkedIn archive files, header metadata and short bullets
under `SKILLS & KEYWORDS` are extracted deterministically before this step.
Keywords are retained as unclassified skills and are never promoted to required
or preferred qualifications. Archive separators, repeated metadata, navigation
text, and provenance footers are excluded locally with auditable reasons. These
optimizations do not bypass the local schema, complete block accounting,
semantic checks, or exact source-evidence validation.

There is deliberately no automatic fallback between providers. Authentication,
configuration, timeout, rate-limit, request, and invalid-response failures are
reported through stable `SEMANTIC_PROVIDER_*` categories. All provider output is
treated as untrusted: the same local schema, block accounting, and source-evidence
checks run before output can be accepted.

Set `JOB_PARSER_DEBUG=1` to write local diagnostics alongside the requested
output. `<output>.provider.json` records the effective provider, model, and
whether it was used. `<output>.provider-response.json` contains the raw model
response, and `<output>.intermediate.json` contains the validated intermediate
extraction. These files may contain source job-description text and should not be
committed.

All provider tests are mocked and run without network access or secrets:

```sh
npm run test:job-parser-providers
npm run test:gemini-provider
npm run test:ollama-provider
```
