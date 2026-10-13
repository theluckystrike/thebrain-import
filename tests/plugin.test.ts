import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TheBrainImportPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { makePlan, readJson, type BrainSource } from '../src/brain';
import { ImportWriteError, noteMarkdown, writeImport } from '../src/writer';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());
function source(): BrainSource {
	const s = readJson(JSON.stringify([{ Id: 'a', Name: 'Plan', Label: 'Label: R', CreationDateTime: '2020-01-01', ModificationDateTime: '2020-01-02' }, { Id: 'b', Name: 'Plan' }]), JSON.stringify([{ ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 1 }]));
	s.files = { 'a/Notes/notes.md': new TextEncoder().encode('Source note body'), 'a/Attachments/x/Map.txt': new Uint8Array([65, 66]) };
	s.attachments = [{ Id: 'x', ThoughtId: 'a', Name: 'Map.txt' }];
	return s;
}
const extras = { ...DEFAULT_SETTINGS, bodies: true, attachments: true, canvas: true };
function memoryVault() {
	const files = new Map<string, string | ArrayBuffer>();
	const folders = new Set<string>();
	return {
		files, folders,
		getRoot: () => ({ children: [...folders, ...files.keys()].filter((path) => !path.includes('/')).map((path) => ({ path })) }) as never,
		getAbstractFileByPath: (path: string) => files.has(path) || folders.has(path) ? {} as never : null,
		createFolder: vi.fn(async (path: string) => { if (folders.has(path)) throw new Error('exists'); folders.add(path); return {} as never; }),
		create: vi.fn(async (path: string, body: string) => { if (files.has(path)) throw new Error('exists'); files.set(path, body); return {} as never; }),
		createBinary: vi.fn(async (path: string, body: ArrayBuffer) => { if (files.has(path)) throw new Error('exists'); files.set(path, body); return {} as never; }),
	};
}
describe('plugin and Pro state', () => {
	it('loads default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new TheBrainImportPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});
	it('repairs bad settings', () => {
		expect(normalizeSettings({ bodies: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('follows the Sponsors manager and removes listeners on reset', () => {
		let active = false;
		let changed = () => {};
		const off = vi.fn();
		bindPro({ isPro: () => active, onChange: (cb: () => void) => { changed = cb; return off; } } as never);
		const cb = vi.fn();
		const remove = onProChange(cb);
		expect(isPro()).toBe(false);
		active = true; changed();
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledOnce();
		remove(); changed();
		expect(cb).toHaveBeenCalledOnce();
		resetPro();
		expect(off).toHaveBeenCalledOnce();
		expect(isPro()).toBe(false);
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, sponsorLogin: 'theluckystrike', scope: 'read:user' });
	});
});
describe('vault import', () => {
	it('writes linked notes and a count report for free even when extras are on', async () => {
		const vault = memoryVault();
		const s = source();
		const report = await writeImport(vault, s, makePlan(s), extras, false);
		expect(report).toMatchObject({ notes: 2, bodies: 0, attachments: 0, canvas: false });
		expect(vault.createBinary).not.toHaveBeenCalled();
		const content = String(vault.files.get('TheBrain import/Plan.md'));
		expect(content).toContain('thebrain_id: a');
		expect(content).toContain('## Children\n\n- [[TheBrain import/Plan (2)|Plan (2)]]');
		expect(content).not.toContain('Source note body');
		expect(content).not.toContain('## Attachments');
		expect(vault.files.has('TheBrain import/TheBrain.canvas')).toBe(false);
		expect(JSON.parse(String(vault.files.get('TheBrain import/Import report.txt')))).toEqual(report);
	});
	it('imports the supported extras with Pro', async () => {
		const vault = memoryVault(); const s = source();
		const report = await writeImport(vault, s, makePlan(s), extras, true);
		expect(report).toMatchObject({ notes: 2, bodies: 1, attachments: 1, canvas: true });
		expect(String(vault.files.get('TheBrain import/Plan.md'))).toContain('Source note body');
		expect(String(vault.files.get('TheBrain import/Plan.md'))).toContain('[[TheBrain import/Attachments/Map.txt|Map.txt]]');
		expect(new Uint8Array(vault.files.get('TheBrain import/Attachments/Map.txt') as ArrayBuffer)).toEqual(new Uint8Array([65, 66]));
		expect(JSON.parse(String(vault.files.get('TheBrain import/TheBrain.canvas'))).nodes).toHaveLength(2);
	});
	it('keeps existing files and uses a new folder on a second import', async () => {
		const vault = memoryVault(); const s = source();
		vault.folders.add('TheBrain import'); vault.files.set('TheBrain import/Plan.md', 'Existing note');
		const report = await writeImport(vault, s, makePlan(s), DEFAULT_SETTINGS, false);
		expect(report.folder).toBe('TheBrain import 2');
		expect(vault.files.get('TheBrain import/Plan.md')).toBe('Existing note');
	});
	it('avoids a root folder with a different case', async () => {
		const vault = memoryVault(); const s = source();
		vault.folders.add('TheBrain Import');
		const report = await writeImport(vault, s, makePlan(s), DEFAULT_SETTINGS, false);
		expect(report.folder).toBe('TheBrain import 2');
		expect(vault.folders.has('TheBrain Import')).toBe(true);
	});
	it('reports partial writes and does not remove existing data on failure', async () => {
		const vault = memoryVault(); const s = source();
		vault.create.mockRejectedValueOnce(new Error('Disk is full'));
		try { await writeImport(vault, s, makePlan(s), DEFAULT_SETTINGS, false); throw new Error('Expected a failure'); }
		catch (error) { expect(error).toBeInstanceOf(ImportWriteError); expect((error as ImportWriteError).report).toMatchObject({ folder: 'TheBrain import', notes: 0 }); }
	});
	it('does not create a folder for an empty source', async () => {
		const vault = memoryVault(); const s = readJson('[]', '[]');
		await expect(writeImport(vault, s, makePlan(s), DEFAULT_SETTINGS, false)).rejects.toThrow('No thoughts');
		expect(vault.createFolder).not.toHaveBeenCalled();
	});
	it('serializes colon labels as valid frontmatter', () => {
		const s = source();
		const content = noteMarkdown(makePlan(s), 'a', 'TheBrain import', false, []);
		expect(content).toContain('label: "Label: R"');
		expect(content).toContain('created:');
	});
});
