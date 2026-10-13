import { normalizePath, stringifyYaml, type Vault } from 'obsidian';
import { canvasData, nextFolder, planAttachments, type BrainNote, type BrainPlan, type BrainSource } from './brain';
import type { ImportSettings } from './settings';

export interface ImportReport {
	folder: string;
	notes: number;
	bodies: number;
	attachments: number;
	skippedAttachments: number;
	canvas: boolean;
	brokenEndpoints: number;
}
/** Root names are compared without case for portable folder selection. */
export function importFolder(vault: Pick<Vault, 'getRoot' | 'getAbstractFileByPath'>): string {
	const names = new Set(vault.getRoot().children.map((file) => file.path.toLowerCase()));
	return nextFolder((path) => names.has(path.toLowerCase()) || vault.getAbstractFileByPath(normalizePath(path)) !== null);
}

export class ImportWriteError extends Error {
	constructor(readonly report: ImportReport, cause: unknown) {
		super(`Import stopped in ${report.folder} after ${report.notes} notes and ${report.attachments} attachments. ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
// One index for each plan keeps a 10,000 note import linear.
const indexes = new WeakMap<BrainPlan, Map<string, BrainNote>>();
export function noteMarkdown(plan: BrainPlan, id: string, folder: string, body: boolean, attachments: string[]): string {
	let byId = indexes.get(plan);
	if (!byId) indexes.set(plan, byId = new Map(plan.notes.map((note) => [note.id, note])));
	const note = byId.get(id)!;
	const names = { get: (id: string) => byId.get(id)?.file.slice(0, -3) };
	const section = (title: string, ids: string[]) => `## ${title}\n\n${ids.map((id) => `- [[${folder}/${names.get(id)}|${names.get(id)}]]`).join('\n')}${ids.length ? '\n' : ''}\n`;
	let result = `---\n${stringifyYaml(note.frontmatter)}---\n\n# ${note.name.replace(/[\r\n]/g, ' ')}\n\n`;
	if (body && note.body) result += `## Notes\n\n${note.body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()}\n\n`;
	result += section('Parents', note.parents) + section('Children', note.children) + section('Jumps', note.jumps);
	if (attachments.length) result += `## Attachments\n\n${attachments.map((file) => `- [[${folder}/Attachments/${file}|${file}]]`).join('\n')}\n`;
	return result;
}

/** Reserve a fresh folder before creating files. A failed write leaves its count report. */
export async function writeImport(vault: Pick<Vault, 'getRoot' | 'getAbstractFileByPath' | 'createFolder' | 'create' | 'createBinary'>, source: BrainSource, plan: BrainPlan, options: ImportSettings, pro: boolean): Promise<ImportReport> {
	if (plan.notes.length === 0) throw new Error('No thoughts to import.');
	const folder = importFolder(vault);
	const report: ImportReport = { folder, notes: 0, bodies: 0, attachments: 0, skippedAttachments: 0, canvas: false, brokenEndpoints: plan.brokenEndpoints };
	const attachments = pro && options.attachments ? planAttachments(source, plan) : { files: [], skipped: 0 };
	report.skippedAttachments = attachments.skipped;
	try {
		await vault.createFolder(normalizePath(folder));
		if (attachments.files.length) await vault.createFolder(normalizePath(`${folder}/Attachments`));
		for (const file of attachments.files) {
			await vault.createBinary(normalizePath(`${folder}/Attachments/${file.file}`), Uint8Array.from(file.bytes).buffer);
			report.attachments++;
		}
		const linked = new Map<string, string[]>();
		for (const file of attachments.files) linked.set(file.thoughtId, [...linked.get(file.thoughtId) ?? [], file.file]);
		for (const note of plan.notes) {
			await vault.create(normalizePath(`${folder}/${note.file}`), noteMarkdown(plan, note.id, folder, pro && options.bodies, linked.get(note.id) ?? []));
			report.notes++;
			if (pro && options.bodies && note.body) report.bodies++;
		}
		if (pro && options.canvas) {
			await vault.create(normalizePath(`${folder}/TheBrain.canvas`), canvasData(plan, folder));
			report.canvas = true;
		}
		await vault.create(normalizePath(`${folder}/Import report.txt`), `${JSON.stringify(report, null, 2)}\n`);
		return report;
	} catch (error) { throw new ImportWriteError(report, error); }
}
