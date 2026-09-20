import { SvelteKitAuth } from '@auth/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const allowedGroups = (env.ALLOWED_GROUPS ?? '')
	.split(',')
	.map((g) => g.trim())
	.filter(Boolean);

const { handle: authHandle } = SvelteKitAuth({
	trustHost: true,
	secret: env.AUTH_SECRET,
	providers: [
		{
			id: 'oidc',
			name: 'Authentik',
			type: 'oidc',
			issuer: env.AUTH_OIDC_ISSUER,
			clientId: env.AUTH_OIDC_ID,
			clientSecret: env.AUTH_OIDC_SECRET,
			authorization: { params: { scope: 'openid email profile' } }
		}
	],
	callbacks: {
		async signIn({ profile }) {
			// No ALLOWED_GROUPS configured: any user who can complete the OIDC flow is let in.
			if (allowedGroups.length === 0) return true;
			const groups = (profile?.groups as string[] | undefined) ?? [];
			return groups.some((g) => allowedGroups.includes(g));
		}
	}
});

/** Everything (app pages + APIs) requires a session — except in dev or when
 *  AUTH_DISABLED=1 (used by the headless E2E test), where a synthetic local
 *  user is injected so the app is fully usable without an OIDC provider. */
const authDisabled = env.AUTH_DISABLED === '1' || (env.NODE_ENV === 'development' && env.AUTH_DISABLED !== '0');

const requireAuth: Handle = async ({ event, resolve }) => {
	if (authDisabled) {
		event.locals.userId = 'local-dev-user';
	} else {
		const session = await event.locals.auth();
		if (!session && !event.url.pathname.startsWith('/auth')) {
			throw redirect(303, `/auth/signin?callbackUrl=${encodeURIComponent(event.url.pathname)}`);
		}
		// Expose the stable user id to server routes for storage scoping.
		if (session?.user) {
			event.locals.userId = (session.user as { sub?: string }).sub ?? 'unknown';
		}
	}
	return resolve(event);
};

export const handle = sequence(authHandle, requireAuth);
