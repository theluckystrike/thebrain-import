import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { strToU8, zipSync } from 'fflate';
import TheBrainImportPlugin from '../src/main';
import { makePlan, readJson } from '../src/brain';
import { resetPro } from '../src/pro';
import { noteMarkdown } from '../src/writer';
import manifest from '../manifest.json';

afterEach(() => resetPro());

describe('audit note bodies', () => {
	it('does not count or write a body that has only white space', () => {
		const source = readJson(JSON.stringify([{ Id: 'a', Name: 'A' }]), '[]');
		source.files = { 'a/Notes/notes.md': strToU8('﻿\n  \r\n\t\n') };
		const plan = makePlan(source);
		expect(plan.bodyCount).toBe(0);
		expect(noteMarkdown(plan, 'a', 'F', true, [])).not.toContain('## Notes');
	});
});

describe('audit import dialog', () => {
	it('does not keep the selected export after the dialog closes during the file read', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new TheBrainImportPlugin(app as never, manifest as never);
		const modal = plugin.openImport();
		const bytes = zipSync({ 'thoughts.json': strToU8('[{"Id":"a","Name":"A"}]'), 'links.json': strToU8('[]') });
		let release = () => {};
		const file = { name: 'brain.brz', size: bytes.length, arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { release = () => resolve(bytes.buffer); }) } as unknown as File;
		const reading = modal.selectFiles([file]);
		modal.close();
		release();
		await reading;
		expect((modal as unknown as { source: unknown }).source).toBeUndefined();
	});
});
