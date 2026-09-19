/** Shared types for the NoteWriter app. */

export interface NoteChunk {
	/** Original note text, ~100 words with overlap. */
	text: string;
	/** Index into the notes text (start offset) — used for ordering results. */
	start: number;
	/** BM25 stats */
	tf: Map<string, number>;
	len: number;
}

export interface RetrievedChunk {
	chunk: NoteChunk;
	score: number;
}

export interface CompletionRequest {
	/** Prefix text (last ~200 chars of the draft) to complete from. */
	prefix: string;
	/** Retrieved note snippets to ground the completion. */
	notes: string[];
	/** Max completion tokens. */
	maxTokens: number;
	/** Model override; falls back to settings default. */
	model?: string;
	/** Optional upstream override: absolute base URL of an OpenAI-compatible API.
	 *  The server proxy forwards to this instead of its env default. */
	upstreamBaseUrl?: string;
	/** Optional upstream API key (third-party endpoints). Sent per-request,
	 *  never persisted server-side. */
	upstreamApiKey?: string;
}

export interface CompletionResponse {
	text: string;
	/** Round-trip latency in ms. */
	latencyMs: number;
	model: string;
}

export interface Settings {
	/** Upstream OpenAI-compatible base URL, e.g. https://api.groq.com/openai/v1.
	 *  Empty = use the server's configured default (llm.cs cluster endpoint). */
	apiBaseUrl: string;
	/** API key for third-party upstreams. Empty = server-held key. */
	apiKey: string;
	/** Model id for inline completions (fast, e.g. gpt-oss-120b). */
	model: string;
	/** Model id for the "expand" action (slow, e.g. glm-5.3-int4). */
	smartModel: string;
	/** Pause before requesting a completion (ms). */
	idleDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
	apiBaseUrl: '',
	apiKey: '',
	model: 'gpt-oss-120b',
	smartModel: 'glm-5.3-int4',
	idleDelayMs: 400
};

/** localStorage keys */
export const LS_KEYS = {
	notes: 'notewriter.notes',
	draft: 'notewriter.draft',
	settings: 'notewriter.settings'
} as const;
