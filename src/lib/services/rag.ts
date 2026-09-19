/**
 * rag.ts — Client-side note chunking + retrieval.
 *
 * Two modes:
 *  - BM25 (always available, zero-latency, runs in-page).
 *  - Hybrid BM25 + embeddings (optional; embeddings computed server-side via
 *    /api/embed so no API key is ever exposed to the browser).
 *
 * Chunking: paragraph-aware splitting into ~100-word chunks with ~25-word
 * overlap so sentence boundaries that straddle a chunk boundary stay retrievable.
 */

import type { NoteChunk, RetrievedChunk } from '$lib/types';

const STOPWORDS = new Set([
	'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
	'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'have', 'has',
	'had', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'of', 'in',
	'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into', 'about', 'over', 'after', 'under',
	'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her',
	'i', 'me', 'my', 'not', 'no', 'so', 'such', 'there', 'here', 'when', 'where', 'which', 'who',
	'what', 'how', 'why', 'also', 'more', 'most', 'other', 'some', 'any', 'each', 'very', 'just'
]);

/** Tokenize text into lowercase terms (words >= 2 chars, no stopwords). */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
		.split(/\s+/)
		.filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** Average chunk size in words; chunks may run longer on long paragraphs. */
const TARGET_WORDS = 100;
/** Words of overlap between consecutive chunks. */
const OVERLAP_WORDS = 25;

/**
 * Split notes text into overlapping ~100-word chunks.
 * Prefers splitting on blank lines (paragraphs), then sentence boundaries.
 */
export function chunkNotes(text: string): NoteChunk[] {
	const chunks: NoteChunk[] = [];
	if (!text.trim()) return chunks;

	const paragraphs = text.split(/\n\s*\n/);
	let window: string[] = [];
	let windowStart = 0;
	let cursor = 0; // absolute char offset tracking

	const flush = () => {
		if (window.length === 0) return;
		const chunkText = window.join(' ');
		chunks.push({
			text: chunkText,
			start: windowStart,
			tf: termFreq(tokenize(chunkText)),
			len: window.length
		});
		// Keep the tail of this chunk as overlap for the next one.
		window = window.slice(Math.max(0, window.length - OVERLAP_WORDS));
		windowStart = cursor - window.join(' ').length;
	};

	for (const para of paragraphs) {
		const paraWords = para.trim().split(/\s+/);
		if (paraWords.length === 0) continue;
		const paraStart = text.indexOf(para, cursor);
		cursor = paraStart + para.length;

		if (window.length + paraWords.length <= TARGET_WORDS) {
			window.push(...paraWords);
			continue;
		}
		// Paragraph doesn't fit — split at sentence boundaries to fill the window.
		const sentences = para.match(/[^.!?\n]+[.!?]*/g) ?? [para];
		for (const s of sentences) {
			const words = s.trim().split(/\s+/);
			if (window.length + words.length > TARGET_WORDS) {
				flush();
			}
			window.push(...words);
		}
	}
	flush();
	return chunks;
}

/** Term frequency map for a token list. */
function termFreq(tokens: string[]): Map<string, number> {
	const tf = new Map<string, number>();
	for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
	return tf;
}

/**
 * In-memory BM25 index over note chunks.
 * Rebuilt whenever notes change (debounced by the caller).
 */
export class NotesIndex {
	private chunks: NoteChunk[] = [];
	private df = new Map<string, number>(); // document frequency
	private avgLen = 0;
	/** Cache of embedding vectors per chunk start offset (hybrid mode). */
	private embeddings = new Map<number, Float32Array>();

	/** Rebuild the index from raw notes text. Returns the number of chunks. */
	rebuild(notes: string): number {
		this.chunks = chunkNotes(notes);
		this.df = new Map();
		let total = 0;
		for (const c of this.chunks) {
			for (const t of c.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
			total += c.len;
		}
		this.avgLen = this.chunks.length ? total / this.chunks.length : 0;
		// Embeddings are keyed by chunk content hash-ish (start offset); stale ones dropped.
		this.embeddings.clear();
		return this.chunks.length;
	}

	get size(): number {
		return this.chunks.length;
	}

	/** BM25 retrieval. Returns top-k chunks ranked by score. */
	search(query: string, k = 2): RetrievedChunk[] {
		if (this.chunks.length === 0) return [];
		const k1 = 1.5;
		const b = 0.75;
		const qTokens = tokenize(query);
		if (qTokens.length === 0) return [];

		const scored: RetrievedChunk[] = [];
		for (const chunk of this.chunks) {
			let score = 0;
			for (const t of qTokens) {
				const tf = chunk.tf.get(t);
				if (!tf) continue;
				const df = this.df.get(t) ?? 1;
				const idf = Math.log(1 + (this.chunks.length - df + 0.5) / (df + 0.5));
				score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunk.len / this.avgLen)));
			}
			if (score > 0) scored.push({ chunk, score });
		}
		scored.sort((a, b2) => b2.score - a.score);
		return scored.slice(0, k);
	}

	/** Set the embedding vector for a chunk (hybrid mode, filled asynchronously). */
	setEmbedding(start: number, vec: Float32Array): void {
		this.embeddings.set(start, vec);
	}

	/** Fraction of chunks with embeddings (0..1) — progress indicator. */
	get embeddingCoverage(): number {
		if (this.chunks.length === 0) return 0;
		return this.embeddings.size / this.chunks.length;
	}

	/** Hybrid BM25 + cosine similarity retrieval. Falls back to pure BM25 when
	 *  embeddings are not (yet) available for a chunk. */
	searchHybrid(query: string, queryVec: Float32Array | null, k = 2): RetrievedChunk[] {
		const bm25 = this.search(query, k * 3); // candidate pool
		if (!queryVec || this.embeddings.size === 0) return bm25.slice(0, k);
		const out: RetrievedChunk[] = [];
		for (const { chunk, score } of bm25) {
			const vec = this.embeddings.get(chunk.start);
			const cos = vec ? cosine(vec, queryVec) : 0;
			// Normalize BM25 into a comparable range then blend 50/50.
			const blended = score / (1 + score) + 0.8 * cos;
			out.push({ chunk, score: blended });
		}
		// Chunks without embeddings yet keep their pure-BM25 ranking via the blend above.
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, k);
	}
}

function cosine(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Extract the "active context" from the draft: the current paragraph up to the
 * cursor (or last 200 chars of it) — this is the retrieval query.
 */
export function activeQuery(draft: string, cursor: number): string {
	const upToCursor = draft.slice(0, cursor);
	// Paragraph = text since the last blank line.
	const paraStart = upToCursor.lastIndexOf('\n\n');
	const para = paraStart === -1 ? upToCursor : upToCursor.slice(paraStart + 2);
	return para.length > 200 ? para.slice(-200) : para;
}
