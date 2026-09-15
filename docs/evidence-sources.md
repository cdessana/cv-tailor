# Supporting evidence sources

Supporting sources are manual provenance metadata. CV Tailor never opens URLs, scrapes profiles, crawls repositories, or turns a reference into a claim automatically.

The machine-readable contract is [`schemas/evidence-sources.schema.json`](../schemas/evidence-sources.schema.json). Pass a source file to the CLI with:

```bash
node scripts/build-evidence.mjs data/resumes/base.json --sources examples/evidence-sources.references.json
```

`examples/evidence-sources.references.json` is a valid, runnable reference-only example for LinkedIn, GitHub, and feedback.

## Reference-only sources

Use this when a source should be recorded but contains no claim to review yet:

```json
[
  { "type": "linkedin", "reference": "https://www.linkedin.com/in/example" },
  { "type": "github", "reference": "https://github.com/example/project" },
  { "type": "feedback", "reference": "feedback/manager-q3.md" }
]
```

Allowed types are `linkedin`, `github`, `feedback`, and `manual`. The file may also be wrapped as `{ "supportingSources": [...] }`.

## Adding an explicit claim

First build the candidate using the same structured resume. Then inspect its contexts:

```bash
jq '.contexts[] | { id, company, position, period, project }' output/evidence/evidence-candidate.json
```

Copy the exact `id` for the role or project that the source supports. Do not guess it or attach a claim to a similar employer/role. Rebuild with a source file such as:

```json
{
  "supportingSources": [
    {
      "type": "feedback",
      "reference": "feedback/manager-q3.md",
      "claims": [
        {
          "contextId": "context_copied_from_candidate",
          "claim": "Maintained payment APIs.",
          "skills": ["Node.js", "PostgreSQL"]
        }
      ]
    }
  ]
}
```

The builder rejects an unknown `contextId`. Source claims remain `pending` and require human approval before promotion. To declare an explicit disagreement, add `conflictsWith` containing a claim ID or the exact wording of an existing claim; the result is a blocking `source_claim_conflict`.
