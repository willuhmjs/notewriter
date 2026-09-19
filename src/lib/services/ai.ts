/**
 * ai.ts — LLM completion fetcher.
 *
 * All requests go through this app's server proxy (/api/llm), which injects
 * the system prompt and the API key. Third-party endpoints (Groq, OpenRouter,
 * Ollama, …) are configured client-side and FORWARDED by the proxy — the key
 * never has to be baked into the browser bundle and CORS is a non-issue.
 *
 * Non-streaming on purpose: 5-15-word completions render slower char-by-char
 * than as a single ghost-text swap.
 */

import type { CompletionRequest, CompletionResponse } from '$lib/types';

const PROXY_BASE = '/api/llm';
const TIMEOUT_MS = 12000;

/** Request an inline completion from the proxy. */
export async function completeSentence(req: CompletionRequest): Promise<CompletionResponse> {
	const t0 = performance.now();
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${PROXY_BASE}/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				prefix: req.prefix,
				notes: req.notes,
				max_tokens: req.maxTokens,
				...(req.model ? { model: req.model } : {}),
				...(req.upstreamBaseUrl ? { upstreamBaseUrl: req.upstreamBaseUrl } : {}),
				...(req.upstreamApiKey ? { upstreamApiKey: req.upstreamApiKey } : {})
			}),
			signal: ctrl.signal
		});
		if (!res.ok) {
			throw new Error(`Completion failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
		}
		const data = (await res.json()) as { text: string; model: string };
		return {
			text: data.text,
			latencyMs: Math.round(performance.now() - t0),
			model: data.model
		};
	} finally {
		clearTimeout(timer);
	}
}
