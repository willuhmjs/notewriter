import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callLLM, defaults } from '$lib/server/llm';

/**
 * POST /api/llm/completions
 * Server-side proxy: browser sends {prefix, notes, max_tokens?, model?,
 * upstreamBaseUrl?, upstreamApiKey?}. We inject the API key + strict system
 * prompt and call the OpenAI-compatible endpoint. The server-held key
 * (LLM_API_KEY env, from a Kubernetes secret) never reaches the browser;
 * client-supplied upstream credentials are used only for that request.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: {
		prefix: string;
		notes: string[];
		max_tokens?: number;
		model?: string;
		task?: 'complete' | 'expand';
		upstreamBaseUrl?: string;
		upstreamApiKey?: string;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	if (typeof body.prefix !== 'string' || !Array.isArray(body.notes)) {
		return json({ error: 'prefix and notes required' }, { status: 400 });
	}

	// Client-configured upstream wins when it's an absolute URL; else env default.
	const upstream = body.upstreamBaseUrl?.trim();
	const baseUrl =
		upstream && /^https?:\/\//i.test(upstream) ? upstream : process.env.LLM_API_BASE_URL || defaults.apiBaseUrl;
	const apiKey = body.upstreamApiKey?.trim() || process.env.LLM_API_KEY || '';
	const fallbackModel = process.env.LLM_DEFAULT_MODEL || defaults.defaultModel;

	try {
		const { text, model } = await callLLM(body, baseUrl, apiKey, fallbackModel);
		return json({ text, model });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ error: msg }, { status: 502 });
	}
};
