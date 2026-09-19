// See https://svelte.dev/docs/kit/types#app.d.ts
import type { getSession } from '@auth/sveltekit';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth: typeof getSession;
			/** OIDC sub claim — scopes all project storage. */
			userId: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
