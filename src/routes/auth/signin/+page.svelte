<script lang="ts">
	import { signIn } from '@auth/sveltekit/client';
</script>

<div class="flex h-dvh flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-200">
	<div class="flex items-center gap-3">
		<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2 6s1.5-2 5-2 5 2 5 2v14s-1.5-2-5-2-5 2-5 2z" />
			<path d="M22 6s-1.5-2-5-2-5 2-5 2v14s1.5-2 5-2 5 2 5 2z" />
		</svg>
		<span class="text-xl font-semibold tracking-tight">NoteWriter</span>
	</div>
	<p class="max-w-sm text-center text-sm text-zinc-500">
		Notes-grounded autocomplete writing. Sign in with your homelab account to access your projects.
	</p>
	<button
		onclick={() => signIn('oidc', { callbackUrl: '/' })}
		class="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
	>
		Sign in
	</button>
</div>
