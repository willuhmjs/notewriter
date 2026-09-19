import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteProject, getProject, saveProject } from '$lib/server/store';

type Body = Partial<{ name: string; notes: string; draft: string }>;

/** GET one project. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const project = await getProject(locals.userId, params.id);
	if (!project) return json({ error: 'not found' }, { status: 404 });
	return json({ project });
};

/** PATCH — save notes/draft/name (autosave). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body) return json({ error: 'invalid JSON' }, { status: 400 });
	const patch: Body = {};
	if (typeof body.name === 'string') patch.name = body.name;
	if (typeof body.notes === 'string') patch.notes = body.notes;
	if (typeof body.draft === 'string') patch.draft = body.draft;
	if (Object.keys(patch).length === 0) return json({ error: 'nothing to update' }, { status: 400 });
	const project = await saveProject(locals.userId, params.id, patch);
	if (!project) return json({ error: 'not found' }, { status: 404 });
	return json({ project });
};

/** DELETE a project. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const ok = await deleteProject(locals.userId, params.id);
	if (!ok) return json({ error: 'not found' }, { status: 404 });
	return json({ ok: true });
};
