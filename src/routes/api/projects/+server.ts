import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createProject, listProjects } from '$lib/server/store';

/** GET /api/projects — list the signed-in user's projects. */
export const GET: RequestHandler = async ({ locals }) => {
	return json({ projects: await listProjects(locals.userId) });
};

/** POST /api/projects — create a project { name }. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await request.json().catch(() => ({}))) as { name?: string };
	const project = await createProject(locals.userId, body.name ?? '');
	return json({ project }, { status: 201 });
};
