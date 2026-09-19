/**
 * Server-only project store: JSON files on a persistent volume.
 *
 * Layout:  DATA_DIR/<userHash>/<projectId>.json
 * Files are written atomically (tmp + rename) so a crash never corrupts a
 * project. DATA_DIR defaults to /data (the PVC mount in the cluster).
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Project } from '$lib/types';

const DATA_DIR = process.env.DATA_DIR ?? '/data';


/** Stable, private directory name for a user (no PII on disk). */
export function userDir(userSub: string): string {
	return createHash('sha256').update(userSub).digest('hex').slice(0, 24);
}

function safeId(id: string): boolean {
	return /^[a-z0-9-]{1,64}$/.test(id);
}

function fileFor(userSub: string, id: string): string {
	return path.join(DATA_DIR, userDir(userSub), `${id}.json`);
}

function dirFor(userSub: string): string {
	return path.join(DATA_DIR, userDir(userSub));
}

export async function listProjects(userSub: string): Promise<Project[]> {
	try {
		const files = await readdir(dirFor(userSub));
		const projects: Project[] = [];
		for (const f of files) {
			if (!f.endsWith('.json')) continue;
			try {
				const raw = await readFile(path.join(dirFor(userSub), f), 'utf-8');
				projects.push(JSON.parse(raw) as Project);
			} catch {
				/* skip corrupt file */
			}
		}
		projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		return projects;
	} catch {
		return []; // no dir yet
	}
}

export async function getProject(userSub: string, id: string): Promise<Project | null> {
	if (!safeId(id)) return null;
	try {
		const raw = await readFile(fileFor(userSub, id), 'utf-8');
		return JSON.parse(raw) as Project;
	} catch {
		return null;
	}
}

export async function saveProject(
	userSub: string,
	id: string,
	patch: Partial<Pick<Project, 'name' | 'notes' | 'draft'>>
): Promise<Project | null> {
	if (!safeId(id)) return null;
	const existing = await getProject(userSub, id);
	if (!existing) return null; // create via createProject only
	const updated: Project = {
		...existing,
		...patch,
		updatedAt: new Date().toISOString()
	};
	const file = fileFor(userSub, id);
	const tmp = `${file}.tmp-${Date.now()}`;
	await mkdir(dirFor(userSub), { recursive: true });
	await writeFile(tmp, JSON.stringify(updated, null, '\t'));
	await rename(tmp, file);
	return updated;
}

export async function createProject(userSub: string, name: string): Promise<Project> {
	const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const project: Project = {
		id,
		name: name.trim() || 'Untitled',
		notes: '',
		draft: '',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
	await mkdir(dirFor(userSub), { recursive: true });
	const file = fileFor(userSub, id);
	const tmp = `${file}.tmp-${Date.now()}`;
	await writeFile(tmp, JSON.stringify(project, null, '\t'));
	await rename(tmp, file);
	return project;
}

export async function deleteProject(userSub: string, id: string): Promise<boolean> {
	if (!safeId(id)) return false;
	try {
		await rm(fileFor(userSub, id));
		return true;
	} catch {
		return false;
	}
}
