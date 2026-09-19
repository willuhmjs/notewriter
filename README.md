# NoteWriter

Split-screen writing app with **note-grounded inline autocomplete**.

- **Left panel** — notes/research. Text is chunked (~100 words, overlapping) and
  indexed in-memory with BM25 (1s debounce).
- **Right panel** — Monaco drafting editor. After a typing pause (default 400ms)
  the current paragraph is used to retrieve the top-2 note chunks, which are sent
  to an LLM with a strict grounded-completion prompt. The result renders as VS Code
  style ghost text: **Tab** accepts, **Esc**/typing dismisses.
- Notes + draft persist to localStorage; settings (endpoint, models, key, delay)
  persist alongside.

## Architecture

- SvelteKit (Svelte 5 runes) + TypeScript + Tailwind CSS 4 + Monaco + lucide-svelte
- `src/lib/services/rag.ts` — chunker + BM25 index
- `src/lib/services/ai.ts` — client fetcher (always via server proxy)
- `src/lib/server/llm.ts` — prompt building + upstream call
- `src/routes/api/llm/completions` — server proxy. Holds the real API key in
  `LLM_API_KEY` (env / Kubernetes secret); never ships to the browser. Custom
  upstreams (Groq, OpenRouter, Ollama, …) configured in Settings are forwarded
  through it, so no CORS issues and no key in the bundle.

## Env

```
PORT=3000
LLM_API_BASE_URL=https://llm.cs.odu.edu/v1   # OpenAI-compatible
LLM_API_KEY=sk-...                            # server-held
LLM_DEFAULT_MODEL=gpt-oss-120b                # fast inline model
```

Model notes (llm.cs, 2026-09-19): `gpt-oss-120b` reliably returns clean short
completions. `glm-5.3-int4` currently emits garbage on this server (verified with
direct API calls) — selectable but not recommended until fixed upstream.

## Dev

```
npm install
npm run dev
```

## Docker

```
docker build -t notewriter .
docker run -p 3000:3000 -e LLM_API_KEY=... notewriter
```

CI (GitHub Actions) builds and pushes `ghcr.io/willuhmjs/notewriter:latest` (plus
`sha-<short>` tags) on push to main.
