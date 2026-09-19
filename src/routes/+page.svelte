<script lang="ts">
	import { onMount } from 'svelte';
	import { Settings2, NotebookPen, FileText, Cloud, CloudOff, LoaderCircle } from 'lucide-svelte';
	import NotesPanel from '$lib/components/NotesPanel.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { NotesIndex } from '$lib/services/rag';
	import { completeSentence } from '$lib/services/ai';
	import { DEFAULT_SETTINGS, LS_KEYS, type Settings } from '$lib/types';

	// ---- persisted state ----
	let notes = $state('');
	let draft = $state('');
	let settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
	let settingsOpen = $state(false);
	let hydrated = $state(false);

	// ---- derived/live state ----
	const notesIndex = new NotesIndex();
	let indexSize = $state(0);
	let stats = $state({ words: 0, chars: 0, latencyMs: 0, model: null as string | null, thinking: false });

	// ---- split-pane resize ----
	let splitRatio = $state(0.38); // notes panel fraction
	let resizing = false;
	let leftPane: HTMLDivElement | undefined = $state();
	let savedMsg = $state(false);

	const SAVE_DEBOUNCE = 600;
	let saveTimer: ReturnType<typeof setTimeout>;

	/** Debounced persistence to localStorage. */
	function persist() {
		clearTimeout(saveTimer);
		savedMsg = true;
		saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(LS_KEYS.notes, notes);
				localStorage.setItem(LS_KEYS.draft, draft);
				localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
				savedMsg = false;
			} catch {
				/* storage full/blocked — non-fatal */
			}
		}, SAVE_DEBOUNCE);
	}

	/** Debounced index rebuild (1s per spec). */
	let indexTimer: ReturnType<typeof setTimeout>;
	function scheduleIndex() {
		clearTimeout(indexTimer);
		indexTimer = setTimeout(() => {
			indexSize = notesIndex.rebuild(notes);
		}, 1000);
	}

	function handleNotesChange(v: string) {
		notes = v;
		persist();
		scheduleIndex();
	}

	function handleDraftChange(v: string) {
		draft = v;
		persist();
	}

	function handleStats(s: { words: number; chars: number; latencyMs: number; model: string | null; thinking: boolean }) {
		stats = s;
	}

	/**
	 * Editor → retrieval → LLM. Called by Monaco's inline completion provider
	 * after the typing pause; returns the ghost text or null.
	 */
	async function getSuggestion(query: string) {
		const hits = notesIndex.search(query, 2);
		if (hits.length === 0) return null;
		try {
			const res = await completeSentence({
				prefix: query,
				notes: hits.map((h) => h.chunk.text),
				maxTokens: 48,
				model: settings.model,
				upstreamBaseUrl: settings.apiBaseUrl || undefined,
				upstreamApiKey: settings.apiKey || undefined
			});
			if (!res.text) return null;
			return { text: res.text, latencyMs: res.latencyMs, model: res.model };
		} catch {
			return null;
		}
	}

	// ---- split-pane drag ----
	function startResize(e: MouseEvent) {
		resizing = true;
		e.preventDefault();
	}
	function onMove(e: MouseEvent) {
		if (!resizing || !leftPane) return;
		const rect = leftPane.getBoundingClientRect();
		const container = leftPane.parentElement!.getBoundingClientRect();
		splitRatio = Math.min(0.7, Math.max(0.2, (e.clientX - container.left) / container.width));
	}
	function stopResize() {
		resizing = false;
	}

	onMount(() => {
		// hydrate persisted state
		try {
			notes = localStorage.getItem(LS_KEYS.notes) ?? '';
			draft = localStorage.getItem(LS_KEYS.draft) ?? '';
			const s = localStorage.getItem(LS_KEYS.settings);
			if (s) settings = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(s) };
		} catch {
			/* corrupted storage — start fresh */
		}
		indexSize = notesIndex.rebuild(notes);
		hydrated = true;

		return () => {
			clearTimeout(saveTimer);
			clearTimeout(indexTimer);
		};
	});
</script>

<svelte:window onmousemove={onMove} onmouseup={stopResize} />

<div class="flex h-dvh flex-col bg-zinc-950 text-zinc-200 antialiased">
	<!-- ══ Top navbar ══ -->
	<header class="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4">
		<div class="flex items-center gap-2.5">
			<NotebookPen size={18} class="text-sky-400" />
			<span class="text-sm font-semibold tracking-tight">NoteWriter</span>
			<span class="hidden rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">
				notes-grounded autocomplete
			</span>
		</div>
		<div class="flex items-center gap-4 text-xs text-zinc-500">
			<span class="hidden items-center gap-1.5 md:flex">
				{#if stats.thinking}
					<LoaderCircle size={13} class="animate-spin text-sky-400" />
					<span class="text-sky-400">thinking…</span>
				{:else if stats.model}
					<span class="font-mono text-[11px] text-zinc-400">{stats.model}</span>
					<span class="{stats.latencyMs < 800 ? 'text-emerald-400' : stats.latencyMs < 2000 ? 'text-amber-400' : 'text-red-400'}">
						{stats.latencyMs}ms
					</span>
				{/if}
			</span>
			<span class="hidden items-center gap-1 sm:flex">
				{#if savedMsg}
					<Cloud size={13} class="text-amber-400" />
					<span class="text-amber-400">saving…</span>
				{:else}
					<CloudOff size={13} />
					<span>saved locally</span>
				{/if}
			</span>
			<button
				class="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 hover:border-zinc-500 hover:text-zinc-200"
				onclick={() => (settingsOpen = true)}
			>
				<Settings2 size={14} />
				<span class="hidden sm:inline">{settings.model}</span>
			</button>
		</div>
	</header>

	<!-- ══ Split workspace ══ -->
	{#if hydrated}
		<div class="relative flex min-h-0 flex-1">
			<!-- Left: notes -->
			<div
				bind:this={leftPane}
				class="min-w-0 shrink-0 overflow-hidden border-r border-zinc-800"
				style="width: {splitRatio * 100}%"
			>
				<NotesPanel {notes} onNotesChange={handleNotesChange} />
			</div>

			<!-- Drag handle -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				role="separator"
				aria-orientation="vertical"
				class="group relative z-10 w-1 shrink-0 cursor-col-resize bg-zinc-800 transition-colors hover:bg-sky-600"
				onmousedown={startResize}
			>
				<div class="absolute inset-y-0 -left-1.5 -right-1.5"></div>
			</div>

			<!-- Right: drafting editor -->
			<div class="relative min-w-0 flex-1">
				<Editor {draft} {settings} {getSuggestion} onDraftChange={handleDraftChange} onStats={handleStats} />
				<!-- status bar -->
				<div
					class="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between border-t border-zinc-800/60 bg-zinc-950/80 px-4 py-1.5 text-[11px] text-zinc-500 backdrop-blur"
				>
					<span>{indexSize} note chunks · Tab accepts · Esc dismisses</span>
					<span>{stats.words} words · {stats.chars} chars</span>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center text-sm text-zinc-600">Loading workspace…</div>
	{/if}
</div>

<SettingsModal bind:open={settingsOpen} {settings} onClose={() => { settingsOpen = false; persist(); }} />
