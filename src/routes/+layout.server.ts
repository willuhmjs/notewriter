import type { LayoutServerLoad } from './$types';

/** Session for the navbar (user name/email + sign-out). Auth-disabled mode has none. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.auth) return { session: null };
	let session: Awaited<ReturnType<typeof locals.auth>> = null;
	try {
		session = await locals.auth();
	} catch {
		session = null; // auth disabled / no session
	}
	return {
		session: session
			? {
					user: {
						name: (session.user as { name?: string } | null)?.name ?? null,
						email: (session.user as { email?: string } | null)?.email ?? null
					}
				}
			: null
	};
};
