/**
 * Server-only: builds the strict grounded-completion prompt and calls the
 * OpenAI-compatible endpoint. The API key lives in server env (Kubernetes
 * secret), never shipped to the browser.
 *
 * Uses SSE streaming: on this provider glm-5.3-int4 only produces clean output
 * with stream:true (non-streaming returns degenerate tokens), and streaming
 * also lets us stop early once the completion is clearly done.
 */

// NOTE: keep this short. glm-5.3-int4 degenerates into number-salad with a longer
// system prompt on this provider (verified empirically 2026-09-19); gpt-oss is
// insensitive. All strictness constraints live in the user message instead.
const SYSTEM_PROMPT = `Complete the user's unfinished sentence in 5-15 words based strictly on the provided notes. Return only the raw completion string.`;

interface ProxyBody {
	prefix: string;
	notes: string[];
	max_tokens?: number;
	model?: string;
	/** 'complete' (default) or 'expand' for the smart-model rewrite action. */
	task?: 'complete' | 'expand';
}

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** Trim retrieved notes to a char budget so prompts stay small. */
function formatNotes(notes: string[]): string {
	const MAX_CHARS = 1500;
	let out = '';
	for (const n of notes) {
		const t = n.trim();
		if (!t) continue;
		if (out.length + t.length > MAX_CHARS) break;
		out += `- ${t}\n`;
	}
	return out || '(no notes)';
}

export function buildMessages(
	prefix: string,
	notes: string[],
	task: 'complete' | 'expand'
): ChatMessage[] {
	if (task === 'expand') {
		return [
			{
				role: 'system',
				content: `You are a writing assistant. Expand the user's text using STRICTLY the provided notes as the source of facts. Return only the expanded text, no commentary, no markdown.`
			},
			{
				role: 'user',
				content: `Notes:\n${formatNotes(notes)}\n\nText to expand:\n${prefix}`
			}
		];
	}
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content: `Notes:\n${formatNotes(notes)}\n\nComplete this sentence using ONLY facts from the notes (5-15 words, no markdown, no quotes, no explanation). Do not introduce outside facts.\n\nSentence: ${prefix}`
		}
	];
}

export const defaults = {
	apiBaseUrl: process.env.LLM_API_BASE_URL ?? 'https://llm.cs.odu.edu/v1',
	apiKey: process.env.LLM_API_KEY ?? '',
	defaultModel: process.env.LLM_DEFAULT_MODEL ?? 'gpt-oss-120b'
};

/**
 * Call the configured OpenAI-compatible chat completions endpoint via SSE
 * streaming and accumulate the visible content deltas.
 */
export async function callLLM(
	body: ProxyBody,
	baseUrl: string,
	apiKey: string,
	fallbackModel: string
): Promise<{ text: string; model: string }> {
	const model = body.model || fallbackModel;
	const messages = buildMessages(body.prefix, body.notes, body.task ?? 'complete');
	const base = baseUrl.replace(/\/$/, '');

	const res = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
		},
		body: JSON.stringify({
			model,
			messages,
			max_tokens: 512,
			temperature: 0.2,
			stream: true
		})
	});
	if (!res.ok) {
		throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}

	let text = '';
	let returnedModel = model;
	const reader = res.body?.getReader();
	if (reader) {
		const decoder = new TextDecoder();
		let buf = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			// SSE events are separated by blank lines; each data line is JSON.
			const lines = buf.split('\n');
			buf = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const payload = trimmed.slice(5).trim();
				if (payload === '[DONE]') continue;
				try {
					const evt = JSON.parse(payload) as {
						model?: string;
						choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
					};
					if (evt.model) returnedModel = evt.model;
					const delta = evt.choices?.[0]?.delta?.content;
					if (delta) text += delta;
					// We only want the first line of the completion.
					if (evt.choices?.[0]?.finish_reason === 'stop') {
						try {
							await reader.cancel();
						} catch {
							/* stream already closed */
						}
						return { text: sanitizeCompletion(text, body.task ?? 'complete', body.prefix), model: returnedModel };
					}
				} catch {
					/* partial JSON across chunks — wait for more */
				}
			}
		}
	}
	return { text: sanitizeCompletion(text, body.task ?? 'complete', body.prefix), model: returnedModel };
}

/** Strip the ways models violate "raw string only": quotes, markdown, echo. */
export function sanitizeCompletion(raw: string, task: 'complete' | 'expand', prefix = ''): string {
	let t = raw.trim();
	if (task === 'expand') return t;
	t = stripEcho(t, prefix);
	// strip wrapping quotes
	t = t.replace(/^["'«]|["'»]$/g, '').trim();
	// strip markdown emphasis
	t = t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
	// first line only — a completion never spans paragraphs
	const firstLine = t.split('\n')[0];
	return firstLine.trim();
}

/**
 * Models sometimes echo the tail of the prompt before completing. Ghost text
 * is inserted at the cursor, so any echoed suffix of `prefix` would duplicate
 * text in the editor — strip the longest matching overlap.
 */
function stripEcho(completion: string, prefix: string): string {
	if (!prefix) return completion;
	const c = completion.toLowerCase();
	const p = prefix.trimEnd().toLowerCase();
	// Try progressively shorter tails of the prompt as candidate echoes.
	// Require a word boundary at the echo start: a genuine echo repeats whole
	// words ("...discovered in June"), while a completion that merely begins
	// with a shared substring ("iscovered…") must not be truncated.
	const max = Math.min(p.length, c.length);
	for (let k = max; k >= 4; k--) {
		const tail = p.slice(-k);
		if (c.startsWith(tail)) {
			const atWordBoundary = k === p.length || /\s/.test(p[p.length - k - 1] ?? '');
			if (atWordBoundary) {
				return completion.slice(k).replace(/^[\s,;:]+/, '');
			}
		}
	}
	return completion;
}
