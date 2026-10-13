import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import type { BrainSource } from '../../src/brain';
import type { ImportSettings } from '../../src/settings';
import type { ImportReport } from '../../src/writer';

interface TestModal { selectFiles(files: File[]): Promise<void>; startImport(): Promise<void>; close(): void }
interface TestPlugin {
	settings: ImportSettings;
	openImport(source?: BrainSource): TestModal;
	importSource(source: BrainSource, options: ImportSettings): Promise<ImportReport>;
	pro: { signOut(): void; refreshNow(): Promise<unknown>; opts: { http: (req: unknown) => Promise<unknown> } };
}
const thoughts = readFileSync('tests/fixtures/brain-thoughts-fixture.json', 'utf8');
const links = readFileSync('tests/fixtures/brain-links-fixture.json', 'utf8');
const brz = readFileSync('tests/fixtures/brain-test-archive.brz').toString('base64');
const extras = { includeTagThoughts: false, bodies: true, attachments: true, canvas: true };
const testArchive = Buffer.from(zipSync({
	'thoughts.json': strToU8(JSON.stringify([{ Id: 'a', Name: 'Atlas', Label: 'A label', CreationDateTime: '2020-01-01', ModificationDateTime: '2020-01-02' }, { Id: 'b', Name: 'Beacon' }])),
	'links.json': strToU8(JSON.stringify([{ ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 1 }])),
	'a/Notes/notes.md': strToU8('Imported source body'),
	'attachments.json': strToU8(JSON.stringify([{ Id: 'x', ThoughtId: 'a', Name: 'Map.txt', Path: 'a/Attachments/x/Map.txt' }])),
	'a/Attachments/x/Map.txt': strToU8('Map attachment'),
})).toString('base64');

describe('TheBrain import in a vault', () => {
	it('opens the command and previews the BOM JSON fixture with Pro off', async () => {
		await browser.executeObsidianCommand('thebrain-import:import');
		await browser.waitUntil(async () => (await browser.$('.thebrain-import input[type="file"]').isExisting()));
		const state = await browser.executeObsidian(async ({ app }, thoughts, links) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			plugin.pro.signOut();
			const modal = plugin.openImport();
			await modal.selectFiles([new File([thoughts], 'thoughts.json'), new File([links], 'links.json')]);
			return { preview: document.querySelector('.thebrain-preview')?.textContent, disabled: [...document.querySelectorAll('.thebrain-import .setting-item')].filter((row) => row.querySelector('.setting-item-name')?.textContent?.endsWith('(Pro)')).filter((row) => row.querySelector('.checkbox-container')?.classList.contains('is-disabled')).length };
		}, thoughts, links);
		expect(state.preview).toContain('20 notes');
		expect(state.preview).toContain('Names with suffixes: S');
		expect(state.disabled).toBe(3);
	});
	it('imports the preview through the button and creates linked notes with source frontmatter', async () => {
		await browser.$('.thebrain-import button.mod-cta').click();
		await browser.waitUntil(async () => (await browser.$('.thebrain-report')).isExisting());
		const state = await browser.executeObsidian(async ({ app, obsidian }) => {
			const r = app.vault.getAbstractFileByPath('TheBrain import/R.md');
			const suffix = app.vault.getAbstractFileByPath('TheBrain import/S (2).md');
			const report = app.vault.getAbstractFileByPath('TheBrain import/Import report.txt');
			if (!(r instanceof obsidian.TFile) || !(suffix instanceof obsidian.TFile) || !(report instanceof obsidian.TFile)) throw new Error('Missing imported file');
			return { r: await app.vault.read(r), report: JSON.parse(await app.vault.read(report)), modal: document.querySelector('.thebrain-report')?.textContent };
		});
		expect(state.report.notes).toBe(20);
		expect(state.r).toContain('thebrain_id: 24739c42-7ad2-4214-8be9-c9a79644f0f1');
		expect(state.r).toContain('label: R label');
		expect(state.r).toContain('created:');
		expect(state.r).toContain('## Children');
		expect(state.modal).toContain('Created 20 notes');
	});
	it('imports the public archive into a second folder without changing the first import', async () => {
		const state = await browser.executeObsidian(async ({ app, obsidian }, base64) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			const first = app.vault.getAbstractFileByPath('TheBrain import/R.md');
			if (!(first instanceof obsidian.TFile)) throw new Error('First import missing');
			const before = await app.vault.read(first);
			const modal = plugin.openImport();
			await modal.selectFiles([new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'brain.brz')]);
			const preview = document.querySelector('.thebrain-preview')?.textContent;
			await modal.startImport();
			return { preview, unchanged: before === await app.vault.read(first), second: app.vault.getAbstractFileByPath('TheBrain import 2/S (2).md') !== null };
		}, brz);
		expect(state.preview).toContain('20 notes');
		expect(state.preview).toContain('New folder: TheBrain import 2');
		expect(state.unchanged).toBe(true);
		expect(state.second).toBe(true);
	});
	it('counts broken endpoints and resolves duplicate names by ID', async () => {
		const state = await browser.executeObsidian(async ({ app, obsidian }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			plugin.pro.signOut();
			const modal = plugin.openImport();
			await modal.selectFiles([new File([JSON.stringify([{ Id: 'a', Name: 'Plan', TagIds: ['t'] }, { Id: 'b', Name: 'Plan' }, { Id: 't', Name: 'Research', Kind: 4 }])], 'thoughts.json'), new File([JSON.stringify([{ ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 1 }, { ThoughtIdA: 'b', ThoughtIdB: 'a', Relation: 1 }, { ThoughtIdA: 'a', ThoughtIdB: 'missing', Relation: 3 }])], 'links.json')]);
			const preview = document.querySelector('.thebrain-preview')?.textContent;
			await modal.startImport();
			const file = app.vault.getAbstractFileByPath('TheBrain import 3/Plan.md');
			if (!(file instanceof obsidian.TFile)) throw new Error('Plan missing');
			return { preview, body: await app.vault.read(file), tagNote: app.vault.getAbstractFileByPath('TheBrain import 3/Research.md') !== null };
		});
		expect(state.preview).toContain('1 broken endpoints');
		expect(state.body).toContain('Research');
		expect(state.body).toContain('[[TheBrain import 3/Plan (2)|Plan (2)]]');
		expect(state.tagNote).toBe(false);
	});
	it('guards archive extras at the writer with Pro off', async () => {
		const state = await browser.executeObsidian(async ({ app, obsidian }, options) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			plugin.pro.signOut();
			const source: BrainSource = { thoughts: [{ Id: 'a', Name: 'Free' }], links: [], files: { 'a/Notes/notes.md': new TextEncoder().encode('Protected body'), 'Map.txt': new TextEncoder().encode('Protected file') }, attachments: [{ Id: 'x', ThoughtId: 'a', Name: 'Map.txt', Path: 'Map.txt' }] };
			const report = await plugin.importSource(source, options);
			const file = app.vault.getAbstractFileByPath(`${report.folder}/Free.md`);
			if (!(file instanceof obsidian.TFile)) throw new Error('Free note missing');
			return { report, body: await app.vault.read(file), canvas: app.vault.getAbstractFileByPath(`${report.folder}/TheBrain.canvas`) !== null };
		}, extras);
		expect(state.report).toMatchObject({ notes: 1, bodies: 0, attachments: 0, canvas: false });
		expect(state.body).not.toContain('Protected body');
		expect(state.canvas).toBe(false);
	});
	it('imports body attachment bytes and Canvas through a local Sponsors answer', async () => {
		const state = await browser.executeObsidian(async ({ app, obsidian }, base64, options) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			const previousHttp = plugin.pro.opts.http;
			try {
				plugin.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
				app.secretStorage.setSecret('thebrain-import-github-token', 'gho_' + '0'.repeat(36));
				await plugin.pro.refreshNow();
				plugin.settings = options;
				const modal = plugin.openImport();
				await modal.selectFiles([new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'extras.brz')]);
				await modal.startImport();
				const note = app.vault.getAbstractFileByPath('TheBrain import 5/Atlas.md');
				const attachment = app.vault.getAbstractFileByPath('TheBrain import 5/Attachments/Map.txt');
				const canvas = app.vault.getAbstractFileByPath('TheBrain import 5/TheBrain.canvas');
				if (!(note instanceof obsidian.TFile) || !(attachment instanceof obsidian.TFile) || !(canvas instanceof obsidian.TFile)) throw new Error('Pro file missing');
				return { note: await app.vault.read(note), attachment: new TextDecoder().decode(await app.vault.readBinary(attachment)), canvas: JSON.parse(await app.vault.read(canvas)) };
			} finally { plugin.pro.signOut(); plugin.pro.opts.http = previousHttp; }
		}, testArchive, extras);
		expect(state.note).toContain('Imported source body');
		expect(state.note).toContain('[[TheBrain import 5/Attachments/Map.txt|Map.txt]]');
		expect(state.attachment).toBe('Map attachment');
		expect(state.canvas.nodes).toHaveLength(2);
		expect(state.canvas.edges).toHaveLength(1);
	});
	it('shows a parse error without writing a folder', async () => {
		const state = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins['thebrain-import'];
			const modal = plugin.openImport();
			await modal.selectFiles([new File(['{invalid}'], 'thoughts.json'), new File(['[]'], 'links.json')]);
			return { message: document.querySelector('.thebrain-error')?.textContent, newFolder: app.vault.getAbstractFileByPath('TheBrain import 6') !== null };
		});
		expect(state.message).toContain('invalid JSON');
		expect(state.newFolder).toBe(false);
	});
});
