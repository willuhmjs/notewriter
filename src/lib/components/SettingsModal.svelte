<script lang="ts">
	import { X, Settings2, Zap, Brain, Server, Timer, KeyRound } from 'lucide-svelte';
	import { DEFAULT_SETTINGS, type Settings } from '$lib/types';

	let {
		open = $bindable(false),
		settings,
		onClose
	}: {
		open: boolean;
		settings: Settings;
		onClose: () => void;
	} = $props();

	const FAST_MODELS = ['gpt-oss-120b', 'gpt-oss-20b', 'qwen3-8-flash-next', 'codestral-22b'];
	const SMART_MODELS = ['glm-5.3-int4', 'gemma-4-31b-it', 'qwen3.5-122b', 'Kimi-K3', 'llama-3-70b-instruct'];
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
			<header class="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
				<div class="flex items-center gap-2 text-sm font-medium text-zinc-200">
					<Settings2 size={16} class="text-sky-400" />
					Settings
				</div>
				<button
					class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={onClose}
					aria-label="Close settings"
				>
					<X size={16} />
				</button>
			</header>

			<div class="space-y-5 px-5 py-5">
				<!-- API endpoint -->
				<label class="block">
					<span class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
						<Server size={13} /> API Base URL (OpenAI-compatible)
					</span>
					<input
						type="text"
						bind:value={settings.apiBaseUrl}
						class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[13px] text-zinc-200 outline-none focus:border-sky-500"
					/>
					<span class="mt-1 block text-[11px] text-zinc-600">
						Blank = this server's configured default. Custom OpenAI-compatible endpoints (Groq, OpenRouter, Ollama, …) are called server-side on your behalf.
					</span>
				</label>

				<!-- API key (only for third-party upstreams) -->
				<label class="block">
					<span class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
						<KeyRound size={13} /> API key (third-party endpoints only)
					</span>
					<input
						type="password"
						bind:value={settings.apiKey}
						placeholder="blank = server-held key"
						class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[13px] text-zinc-200 outline-none focus:border-sky-500"
					/>
					<span class="mt-1 block text-[11px] text-zinc-600">
						Sent with each request, never stored server-side. Leave blank for the default endpoint.
					</span>
				</label>

				<!-- Model pickers -->
				<div class="grid grid-cols-2 gap-4">
					<label class="block">
						<span class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
							<Zap size={13} /> Fast model (inline ghost)
						</span>
						<input
							list="fast-models"
							bind:value={settings.model}
							placeholder="gpt-oss-120b"
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[13px] text-zinc-200 outline-none focus:border-sky-500"
						/>
						<datalist id="fast-models">
							{#each FAST_MODELS as m}<option value={m}></option>{/each}
						</datalist>
					</label>
					<label class="block">
						<span class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
							<Brain size={13} /> Smart model (expand)
						</span>
						<input
							list="smart-models"
							bind:value={settings.smartModel}
							placeholder="glm-5.3-int4"
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[13px] text-zinc-200 outline-none focus:border-sky-500"
						/>
						<datalist id="smart-models">
							{#each SMART_MODELS as m}<option value={m}></option>{/each}
						</datalist>
					</label>
				</div>

				<!-- Idle delay -->
				<label class="block">
					<span class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
						<Timer size={13} /> Completion trigger delay: {settings.idleDelayMs}ms
					</span>
					<input
						type="range"
						min="200"
						max="1200"
						step="50"
						bind:value={settings.idleDelayMs}
						class="w-full accent-sky-500"
					/>
				</label>
			</div>

			<footer class="flex items-center justify-between border-t border-zinc-800 px-5 py-3.5">
				<button
					class="text-xs text-zinc-500 hover:text-zinc-300"
					onclick={() => Object.assign(settings, DEFAULT_SETTINGS)}
				>
					Reset defaults
				</button>
				<button
					class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
					onclick={onClose}
				>
					Done
				</button>
			</footer>
		</div>
	</div>
{/if}
