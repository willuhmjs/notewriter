<script lang="ts">
	import { onMount } from 'svelte';
	import type * as Monaco from 'monaco-editor';
	import type { Settings } from '$lib/types';

	/**
	 * Drafting editor: self-hosted Monaco with a native inlineCompletionsProvider.
	 *
	 * The provider only fires at the very end of the document after a typing pause,
	 * asks the parent for a notes-grounded suggestion, and Monaco renders it as
	 * ghost text. Tab accepts (Monaco built-in), Escape/typing dismisses (built-in).
	 */

	let {
		draft = '',
		settings,
		getSuggestion,
		onDraftChange,
		onStats
	}: {
		draft: string;
		settings: Settings;
		/** Parent-provided: retrieval + LLM call. Returns null for "no suggestion". */
		getSuggestion: (query: string) => Promise<{ text: string; latencyMs: number; model: string } | null>;
		onDraftChange: (d: string) => void;
		onStats: (s: { words: number; chars: number; latencyMs: number; model: string | null; thinking: boolean }) => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
	/** Last user edit timestamp — used to debounce the provider. */
	let lastEditAt = 0;
	let inflight = false;

	const IDLE_MS = () => settings.idleDelayMs || 400;

	function wordCount(s: string): number {
		return (s.trim().match(/\S+/g) ?? []).length;
	}

	onMount(async () => {
		if (!container) return;
		const monaco = (await import('monaco-editor')) as typeof Monaco;
		// Self-host the sole worker we need (plaintext has no language services).
		// Note: monaco's exports map maps `./*` → `./esm/vs/*`, so no esm/vs prefix here.
		const { default: EditorWorker } = await import('monaco-editor/editor/editor.worker?worker');
		self.MonacoEnvironment = {
			getWorker: () => new EditorWorker()
		};

		monaco.editor.defineTheme('notewriter-dark', {
			base: 'vs-dark',
			inherit: true,
			rules: [],
			colors: {
				'editor.background': '#09090b',
				'editor.foreground': '#d4d4d8',
				'editorGhostText.foreground': '#71717a',
				'editor.lineHighlightBackground': '#09090b',
				'editorLineNumber.foreground': '#3f3f46',
				'editorLineNumber.activeForeground': '#a1a1aa',
				'editorCursor.foreground': '#38bdf8',
				'editor.selectionBackground': '#27272a',
				'editorIndentGuide.background': '#18181b'
			}
		});

		editor = monaco.editor.create(container, {
			value: draft,
			language: 'plaintext',
			theme: 'notewriter-dark',
			fontSize: 14,
			fontFamily: "'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
			lineHeight: 24,
			wordWrap: 'on',
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			renderLineHighlight: 'none',
			quickSuggestions: false,
			occurrencesHighlight: 'off',
			matchBrackets: 'never',
			folding: false,
			glyphMargin: false,
			lineNumbersMinChars: 3,
			padding: { top: 14, bottom: 24 },
			scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
			smoothScrolling: true,
			inlineSuggest: { enabled: true },
			suggestOnTriggerCharacters: false,
			tabSize: 4,
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true
		});

		editor.onDidChangeModelContent(() => {
			const value = editor!.getValue();
			lastEditAt = Date.now();
			onDraftChange(value);
			onStats({
				words: wordCount(value),
				chars: value.length,
				latencyMs: 0,
				model: null,
				thinking: false
			});
		});

		monaco.languages.registerInlineCompletionsProvider('*', {
			async provideInlineCompletions(model, position) {
				// Complete only at the end of the CURRENT LINE (mid-document is fine —
				// e.g. typing above a References section), but not mid-word: there must
				// be a word boundary (or line start) at the cursor.
				if (position.column !== model.getLineMaxColumn(position.lineNumber)) return { items: [] };

				// Debounce: wait out the typing pause inside the provider.
				const wait = IDLE_MS() - (Date.now() - lastEditAt);
				if (wait > 0) await new Promise((r) => setTimeout(r, wait));
				if (model.isDisposed() || !editor) return { items: [] };

				// Current paragraph (up to 300 chars) is the retrieval query.
				const text = model.getValueInRange({
					startLineNumber: Math.max(1, position.lineNumber - 6),
					startColumn: 1,
					endLineNumber: position.lineNumber,
					endColumn: position.column
				});
				const para = text.split(/\n\s*\n/).pop() ?? text;
				const query = para.length > 300 ? para.slice(-300) : para;
				if (query.trim().length < 10) return { items: [] };
				if (inflight) return { items: [] };

				inflight = true;
				onStats({ words: wordCount(model.getValue()), chars: model.getValue().length, latencyMs: 0, model: null, thinking: true });
				try {
					const res = await getSuggestion(query);
					if (!res || !res.text || !editor) return { items: [] };
					// Cursor must still be exactly where we sampled.
					const pos = editor.getPosition();
					if (!pos || pos.column !== model.getLineMaxColumn(pos.lineNumber)) {
						return { items: [] };
					}
					onStats({
						words: wordCount(model.getValue()),
						chars: model.getValue().length,
						latencyMs: res.latencyMs,
						model: res.model,
						thinking: false
					});
					return { items: [{ insertText: res.text }] };
				} catch {
					return { items: [] };
				} finally {
					inflight = false;
				}
			},
			disposeInlineCompletions() {
				/* nothing cached — nothing to free */
			}
		});

		const cleanup = () => {
			editor?.dispose();
		};
		cleanup as () => void;
	});

	/** Public: focus the editor. */
	export function focus(): void {
		editor?.focus();
	}
</script>

<div bind:this={container} class="h-full w-full"></div>
