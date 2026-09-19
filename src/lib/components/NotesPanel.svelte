<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Notebook, FileUp, Trash2, ListChecks } from 'lucide-svelte';
	import { chunkNotes } from '$lib/services/rag';
	import type { NoteChunk } from '$lib/types';

	let {
		notes = $bindable(''),
		onNotesChange
	}: {
		notes: string;
		onNotesChange: (notes: string) => void;
	} = $props();

	let textarea: HTMLTextAreaElement | undefined = $state();
	let chunkCount = $state(0);
	let fileInput: HTMLInputElement | undefined = $state();

	const CHUNK_DEBOUNCE = 1000;
	let debounceTimer: ReturnType<typeof setTimeout>;

	/** Input handler: propagate up (persist + reindex) and refresh the chunk count. */
	function handleInput(e: Event) {
		const v = (e.currentTarget as HTMLTextAreaElement).value;
		onNotesChange(v);
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			chunkCount = chunkNotes(v).length;
		}, CHUNK_DEBOUNCE);
	}

	async function importFile(f: File) {
		const text = await f.text();
		const merged = notes ? `${notes}\n\n${text}` : text;
		onNotesChange(merged);
		chunkCount = chunkNotes(merged).length;
	}

	function onFilePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (f) importFile(f);
		input.value = '';
	}

	onMount(() => {
		chunkCount = chunkNotes(notes).length;
		// Drop .txt/.md files directly onto the panel
		textarea?.addEventListener('drop', (e) => {
			e.preventDefault();
			const f = e.dataTransfer?.files[0];
			if (f && /\.(txt|md)$/i.test(f.name)) importFile(f);
		});
	});
</script>

<div class="flex h-full flex-col">
	<header class="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
		<div class="flex items-center gap-2 text-sm font-medium text-zinc-200">
			<Notebook size={16} class="text-sky-400" />
			Notes &amp; Context
		</div>
		<div class="flex items-center gap-2 text-xs text-zinc-500">
			<span class="inline-flex items-center gap-1">
				<ListChecks size={13} />
				{chunkCount} chunks indexed
			</span>
			<button
				class="rounded p-1.5 hover:bg-zinc-800 hover:text-zinc-200"
				onclick={() => fileInput?.click()}
				title="Import .txt/.md"
			>
				<FileUp size={14} />
			</button>
			<button
				class="rounded p-1.5 hover:bg-zinc-800 hover:text-zinc-200"
				onclick={() => { onNotesChange(''); chunkCount = 0; }}
				title="Clear notes"
			>
				<Trash2 size={14} />
			</button>
		</div>
	</header>
	<textarea
		bind:this={textarea}
		value={notes}
		oninput={handleInput}
		spellcheck="false"
		class="h-full w-full flex-1 resize-none bg-zinc-950 px-4 py-3 font-mono text-[13px] leading-6 text-zinc-300 outline-none placeholder:text-zinc-600"
		placeholder="Paste research, bullet points, source quotes…&#10;&#10;Every ~100 words becomes a searchable chunk. The autocomplete draws ONLY from what's here."
	></textarea>
	<input
		bind:this={fileInput}
		type="file"
		accept=".txt,.md,.markdown,text/plain"
		class="hidden"
		onchange={onFilePick}
	/>
</div>
