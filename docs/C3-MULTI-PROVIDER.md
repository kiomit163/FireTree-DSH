# C3: multi-provider AI review

## Current providers

- `deepseek-account / deepseek-flash` — available in this DSH session.
- `opencode-go` — configured in the DSH desktop profile with:
  - `qwen3.8-flash`
  - `glm-5.3-flash`
  - `longcat-2.5-preview-free`
  - `mimo-v2.6-flash`
  - `step-5-preview-free`
- API key reference: `OPENCODE_GO_API_KEY`.

OpenCode Go was verified with `qwen3.8-flash` returning HTTP 200.

## Review seat CLI

`scripts/opencode-review.mjs` calls one OpenAI-compatible seat and writes a
seat record. It never logs or writes the API key.

```powershell
$env:OPENCODE_GO_API_KEY = '<credential>'
node scripts/opencode-review.mjs `
  --prompt review-prompt.txt `
  --model qwen3.8-flash `
  --diff-sha256 <reviewed-diff-sha256> `
  --out seat-opencode.json
```

The prompt must require JSON:

```json
{
  "verdict": "ready | not-ready",
  "findings": [
    {
      "id": "finding-1",
      "severity": "blocker | non-blocker | question",
      "claim": "...",
      "evidence": "file:line ...",
      "status": "open | resolved"
    }
  ]
}
```

## Combining seats

For `A3-AI`, combine:

- one `deepseek-account` seat from the host model;
- one `opencode-go` seat from this CLI.

The seat `provider` values must differ; otherwise the artifact is only
`A3-AI-S`.

The final `firetree.ai-review/v1` artifact must:

- bind `diff_sha256`;
- have zero unresolved findings;
- converge;
- include both provider seat hashes.

Each seat includes its own `context_sha256`, which binds the system prompt,
user prompt, provider, model, and diff digest. Two seats from the same model
therefore still have distinct context hashes.

The current CLI is fixed to `https://opencode.ai/inference/v1`, provider
`opencode-go`, and `OPENCODE_GO_API_KEY`; it cannot be pointed at an arbitrary
endpoint or a different credential reference. The output path must stay inside
`--root`.

## Security boundary

This CLI is a seat generator, not a trusted decision-maker. The decision is
only `A3-AI` when:

1. at least two distinct provider routes participate;
2. the review artifact is inside the attested bundle;
3. `firetree-check` verifies it with `--require A3-AI`;
4. the PR cannot supply the review itself in production mode.

Until the review service runs outside the PR author's control, this remains a
machine-assisted review path, not an independent third-party audit.
