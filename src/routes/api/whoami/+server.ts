import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Debug route: confirms the auth hook populated locals for API endpoints. */
export const GET: RequestHandler = async ({ locals }) => {
	return json({
		userId: locals.userId ?? '(unset)',
		hasAuthFn: typeof locals.auth
	});
};
