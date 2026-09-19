/**
 * Server-only: builds the strict grounded-completion prompt and calls the
 * OpenAI-compatible endpoint. The API key lives in server env (Kubernetes
 * secret), never shipped to the browser.
 *
 * Note: gpt-oss models emit reasoning tokens; a small max_tokens can be
 * consumed entirely by reasoning and yield null content. We budget for it and
 * retry once with a larger budget if the first attempt returns empty.
 */

const SYSTEM_PROMPT = `You are an inline sentence completion engine. Complete the user's sentence in 5-15 words based STRICTLY on the provided notes. Do NOT introduce outside facts. If the notes do not support a completion, return an empty string. Return ONLY the raw completion string. No markdown, no quotes, no explanation. Do not think step by step; respond immediately with the completion only.`;

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
			content: `Notes:\n${formatNotes(notes)}\n\nSentence to complete: ${prefix}`
		}
	];
}

export const defaults = {
	apiBaseUrl: process.env.LLM_API_BASE_URL ?? 'https://llm.cs.odu.edu/v1',
	apiKey: process.env.LLM_API_KEY ?? '',
	defaultModel: process.env.LLM_DEFAULT_MODEL ?? 'gpt-oss-120b'
};

/** Call the configured OpenAI-compatible chat completions endpoint. */
export async function callLLM(
	body: ProxyBody,
	baseUrl: string,
	apiKey: string,
	fallbackModel: string
): Promise<{ text: string; model: string }> {
	const model = body.model || fallbackModel;
	const messages = buildMessages(body.prefix, body.notes, body.task ?? 'complete');
	const base = baseUrl.replace(/\/$/, '');

	// First attempt with a modest budget; reasoning-heavy models can burn a
	// small budget before emitting any visible content → retry with more room.
	for (const maxTokens of [96, 768, 2048]) {
		const res = await fetch(`${base}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
			},
			body: JSON.stringify({
				model,
				messages,
				max_tokens: maxTokens,
				temperature: 0.2,
				stream: false
			})
		});
		if (!res.ok) {
			throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			choices?: { message?: { content?: string | null } }[];
			model?: string;
		};
		const raw = data.choices?.[0]?.message?.content;
		if (raw && raw.trim()) {
			const text = sanitizeCompletion(raw, body.task ?? 'complete');
			if (text) return { text, model: data.model ?? model };
		}
		// empty content — loop retries with the larger budget, then gives up
	}
	return { text: '', model };
}

/** Strip the ways models violate "raw string only": quotes, markdown, echo. */
export function sanitizeCompletion(raw: string, task: 'complete' | 'expand'): string {
	let t = raw.trim();
	if (task === 'expand') return t;
	// strip wrapping quotes
	t = t.replace(/^["'«]|["'»]$/g, '').trim();
	// strip markdown emphasis
	t = t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
	// model echoed the prefix → keep only the tail
	const firstLine = t.split('\n')[0];
	return firstLine.trim();
}
