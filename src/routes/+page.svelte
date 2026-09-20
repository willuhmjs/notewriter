<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Settings2,
		NotebookPen,
		Cloud,
		CloudOff,
		LoaderCircle,
		FolderOpen,
		Plus,
		LogOut,
		X,
		Trash2
	} from 'lucide-svelte';
	import NotesPanel from '$lib/components/NotesPanel.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { NotesIndex } from '$lib/services/rag';
	import { completeSentence } from '$lib/services/ai';
	import { DEFAULT_SETTINGS, LS_KEYS, type Project, type Settings } from '$lib/types';
	import { page } from '$app/state';
	import { signOut } from '@auth/sveltekit/client';

	// ---- session (from +layout.server.ts) ----
	const session = $derived(page.data.session as { user: { name: string | null; email: string | null } } | null);

	// ---- projects ----
	let projects = $state<Project[]>([]);
	let activeProject = $state<Project | null>(null);
	let loading = $state(true);
	let projectPickerOpen = $state(false);
	let newName = $state('');

	// ---- editor state (local mirror of activeProject.notes/draft) ----
	let notes = $state('');
	let draft = $state('');
	let settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
	let settingsOpen = $state(false);
	let hydrated = $state(false);

	// ---- live state ----
	const notesIndex = new NotesIndex();
	let indexSize = $state(0);
	let stats = $state({ words: 0, chars: 0, latencyMs: 0, model: null as string | null, thinking: false });
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');

	// ---- split-pane ----
	let splitRatio = $state(0.38);
	let resizing = false;
	let leftPane: HTMLDivElement | undefined = $state();

	// ---------- project API ----------
	async function refreshProjects() {
		const res = await fetch('/api/projects');
		const data = (await res.json()) as { projects: Project[] };
		projects = data.projects;
	}

	async function openProject(id: string) {
		const res = await fetch(`/api/projects/${id}`);
		if (!res.ok) return;
		const data = (await res.json()) as { project: Project };
		activeProject = data.project;
		notes = data.project.notes;
		draft = data.project.draft;
		indexSize = notesIndex.rebuild(notes);
		projectPickerOpen = false;
	}

	async function createProject() {
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: newName })
		});
		newName = '';
		await refreshProjects();
		const data = (await res.json()) as { project: Project };
		await openProject(data.project.id);
	}

	async function deleteProject(id: string) {
		await fetch(`/api/projects/${id}`, { method: 'DELETE' });
		if (activeProject?.id === id) {
			activeProject = null;
			notes = '';
			draft = '';
		}
		await refreshProjects();
	}

	/** Debounced autosave of notes/draft to the server. */
	let saveTimer: ReturnType<typeof setTimeout>;
	function scheduleSave(patch: { name?: string; notes?: string; draft?: string }) {
		if (!activeProject) return;
		saveState = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await fetch(`/api/projects/${activeProject!.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(patch)
				});
				saveState = 'saved';
				setTimeout(() => (saveState = 'idle'), 1500);
			} catch {
				saveState = 'idle';
			}
		}, 700);
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
		scheduleSave({ notes: v });
		scheduleIndex();
	}

	function handleDraftChange(v: string) {
		draft = v;
		scheduleSave({ draft: v });
	}

	function handleStats(s: { words: number; chars: number; latencyMs: number; model: string | null; thinking: boolean }) {
		stats = s;
	}

	/** Editor → retrieval → LLM: the ghost-text brain. */
	async function getSuggestion(retrievalQuery: string, prefix: string) {
		const hits = notesIndex.search(retrievalQuery, 4);
		if (hits.length === 0) return null;
		try {
			const res = await completeSentence({
				prefix,
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

	// ---------- split-pane drag ----------
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

	onMount(async () => {
		// settings stay client-side (they may contain third-party keys)
		try {
			const s = localStorage.getItem(LS_KEYS.settings);
			if (s) settings = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(s) };
		} catch {
			/* corrupted storage — defaults */
		}
		await refreshProjects();
		loading = false;
		hydrated = true;
	});

	/** Persist settings whenever the modal closes. */
	$effect.pre(() => {
		if (hydrated && settingsOpen === false) {
			try {
				localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
			} catch {
				/* non-fatal */
			}
		}
	});
</script>

<svelte:window onmousemove={onMove} onmouseup={stopResize} />

<div class="flex h-dvh flex-col bg-zinc-950 text-zinc-200 antialiased">
	<!-- ══ Top navbar ══ -->
	<header class="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4">
		<div class="flex items-center gap-3">
			<NotebookPen size={18} class="text-sky-400" />
			<span class="text-sm font-semibold tracking-tight">NoteWriter</span>
			<button
				class="ml-2 flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
				onclick={() => (projectPickerOpen = true)}
			>
				<FolderOpen size={13} />
				{activeProject ? activeProject.name : 'Open project'}
			</button>
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
				{#if saveState === 'saving'}
					<Cloud size={13} class="animate-pulse text-amber-400" />
					<span class="text-amber-400">saving…</span>
				{:else if saveState === 'saved'}
					<Cloud size={13} class="text-emerald-400" />
					<span class="text-emerald-400">saved</span>
				{:else}
					<CloudOff size={13} />
				{/if}
			</span>
			<button
				class="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 hover:border-zinc-500 hover:text-zinc-200"
				onclick={() => (settingsOpen = true)}
			>
				<Settings2 size={14} />
				<span class="hidden sm:inline">{settings.model}</span>
			</button>
			{#if session?.user}
				<span class="hidden text-zinc-500 lg:inline">{session.user.name ?? session.user.email}</span>
				<button
					class="rounded-lg border border-zinc-700 p-1.5 hover:border-zinc-500 hover:text-zinc-200"
					onclick={() => signOut({ callbackUrl: '/auth/signin' })}
					title="Sign out"
				>
					<LogOut size={14} />
				</button>
			{/if}
		</div>
	</header>

	{#if loading}
		<div class="flex flex-1 items-center justify-center text-sm text-zinc-600">Loading…</div>
	{:else if !activeProject}
		<!-- ══ Project picker (empty state) ══ -->
		<div class="flex flex-1 items-center justify-center">
			<div class="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
				<h2 class="mb-1 text-sm font-semibold text-zinc-200">Projects</h2>
				<p class="mb-4 text-xs text-zinc-500">
					Stored on the server — sign in anywhere and continue where you left off.
				</p>
				<div class="mb-4 max-h-64 space-y-1.5 overflow-y-auto">
					{#each projects as p (p.id)}
						<button
							class="group flex w-full items-center justify-between rounded-lg border border-zinc-800 px-3 py-2.5 text-left hover:border-zinc-600"
							onclick={() => openProject(p.id)}
						>
							<span class="min-w-0">
								<span class="block truncate text-sm text-zinc-200">{p.name}</span>
								<span class="block text-[11px] text-zinc-600">
									{new Date(p.updatedAt).toLocaleString()} · {(p.draft.trim().match(/\S+/g) ?? []).length} words
								</span>
							</span>
							<span
								role="button"
								tabindex="0"
								class="opacity-0 transition-opacity group-hover:opacity-100"
								onclick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
								onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteProject(p.id); } }}
								title="Delete project"
							>
								<Trash2 size={14} class="text-zinc-500 hover:text-red-400" />
							</span>
						</button>
					{:else}
						<p class="py-6 text-center text-xs text-zinc-600">No projects yet.</p>
					{/each}
				</div>
				<div class="flex gap-2">
					<input
						bind:value={newName}
						placeholder="New project name…"
						onkeydown={(e) => e.key === 'Enter' && createProject()}
						class="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-sky-500"
					/>
					<button
						class="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
						onclick={createProject}
					>
						<Plus size={14} /> Create
					</button>
				</div>
			</div>
		</div>
	{:else}
		<!-- ══ Split workspace ══ -->
		<div class="relative flex min-h-0 flex-1">
			<div
				bind:this={leftPane}
				class="min-w-0 shrink-0 overflow-hidden border-r border-zinc-800"
				style="width: {splitRatio * 100}%"
			>
				<NotesPanel bind:notes onNotesChange={handleNotesChange} />
			</div>

			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				role="separator"
				aria-orientation="vertical"
				class="relative z-10 w-1 shrink-0 cursor-col-resize bg-zinc-800 transition-colors hover:bg-sky-600"
				onmousedown={startResize}
			>
				<div class="absolute inset-y-0 -left-1.5 -right-1.5"></div>
			</div>

			<div class="relative min-w-0 flex-1">
				<Editor {draft} {settings} {getSuggestion} onDraftChange={handleDraftChange} onStats={handleStats} />
				<div
					class="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between border-t border-zinc-800/60 bg-zinc-950/80 px-4 py-1.5 text-[11px] text-zinc-500 backdrop-blur"
				>
					<span>{indexSize} note chunks · Tab accepts · Esc dismisses</span>
					<span>{stats.words} words</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- ══ Project picker drawer ══ -->
{#if projectPickerOpen && activeProject}
	<div class="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-24 backdrop-blur-sm" onclick={() => (projectPickerOpen = false)}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-3 flex items-center justify-between">
				<span class="text-sm font-semibold text-zinc-200">Projects</span>
				<button class="text-zinc-500 hover:text-zinc-200" onclick={() => (projectPickerOpen = false)}>
					<X size={16} />
				</button>
			</div>
			<div class="mb-3 max-h-56 space-y-1.5 overflow-y-auto">
				{#each projects as p (p.id)}
					<div class="group flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 hover:border-zinc-600">
						<button class="min-w-0 flex-1 text-left" onclick={() => openProject(p.id)}>
							<span class="block truncate text-sm {p.id === activeProject.id ? 'text-sky-400' : 'text-zinc-200'}">{p.name}</span>
							<span class="block text-[11px] text-zinc-600">{new Date(p.updatedAt).toLocaleString()}</span>
						</button>
						<span
							role="button"
							tabindex="0"
							class="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
							onclick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
							title="Delete"
						>
							<Trash2 size={14} class="text-zinc-500 hover:text-red-400" />
						</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-2">
				<input
					bind:value={newName}
					placeholder="New project…"
					onkeydown={(e) => e.key === 'Enter' && createProject()}
					class="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-sky-500"
				/>
				<button
					class="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
					onclick={createProject}
				>
					<Plus size={14} /> New
				</button>
			</div>
		</div>
	</div>
{/if}

<SettingsModal bind:open={settingsOpen} {settings} onClose={() => (settingsOpen = false)} />
