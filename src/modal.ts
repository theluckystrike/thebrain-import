import { Modal, Notice, Setting } from 'obsidian';
import { MAX_INPUT_BYTES, makePlan, planAttachments, readArchive, readJson, type BrainSource } from './brain';
import { isPro, onProChange } from './pro';
import type TheBrainImportPlugin from './main';
import type { ImportSettings } from './settings';
import { importFolder, type ImportReport } from './writer';

// The brand and tier names keep their case in these shared UI labels.
const UI = { importTitle: 'Import TheBrain export', pickerLabel: 'Select TheBrain export', extrasHeading: 'Archive extras (Pro)' };

export class ImportModal extends Modal {
	private source: BrainSource | undefined;
	private options: ImportSettings;
	private busy = false;
	private closed = false;
	private error = '';
	private report: ImportReport | null = null;
	private stopPro: (() => void) | null = null;
	constructor(private plugin: TheBrainImportPlugin, source?: BrainSource) {
		super(plugin.app);
		this.source = source;
		this.options = { ...plugin.settings };
	}
	onOpen(): void { this.closed = false; this.setTitle(UI.importTitle); this.stopPro = onProChange(() => { if (!this.busy) this.draw(); }); this.draw(); }
	onClose(): void { this.closed = true; this.stopPro?.(); this.stopPro = null; this.contentEl.empty(); this.source = undefined; }
	async selectFiles(files: File[]): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.error = '';
		this.report = null;
		this.source = undefined;
		this.draw();
		try {
			if (files.some((file) => file.size > MAX_INPUT_BYTES)) throw new Error('Select files of 50 MB or less.');
			if (files.length === 1 && /\.brz$/i.test(files[0]!.name)) this.source = readArchive(new Uint8Array(await files[0]!.arrayBuffer()));
			else {
				const thoughts = files.find((file) => /thoughts.*\.json$/i.test(file.name));
				const links = files.find((file) => /links.*\.json$/i.test(file.name));
				if (files.length !== 2 || !thoughts || !links) throw new Error('Select one .brz file, or thoughts.json and links.json together.');
				this.source = readJson(await thoughts.text(), await links.text());
			}
			makePlan(this.source, this.options.includeTagThoughts);
		} catch (error) { this.source = undefined; this.error = error instanceof Error ? error.message : String(error); }
		finally {
			this.busy = false;
			// A close during the file read must not keep the export in memory.
			if (this.closed) this.source = undefined;
			else this.draw();
		}
	}
	private draw(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('thebrain-import');
		if (this.report) {
			new Setting(el).setName('Import complete').setHeading();
			el.createEl('p', { text: `Created ${this.report.notes} notes in ${this.report.folder}.`, cls: 'thebrain-report' });
			el.createEl('p', { text: `${this.report.bodies} note bodies · ${this.report.attachments} attachments · ${this.report.canvas ? '1' : '0'} Canvas files` });
			el.createEl('p', { text: `Skipped ${this.report.brokenEndpoints} broken endpoints and ${this.report.skippedAttachments} attachment entries. See Import report.txt in the folder.` });
			new Setting(el).addButton((b) => b.setButtonText('Close').onClick(() => this.close()));
			return;
		}
		el.createEl('p', { text: 'Select a local .brz archive, or select the two JSON files together. The preview does not write notes.' });
		const upload = el.createEl('input', { attr: { type: 'file', accept: '.brz,.json', multiple: '', 'aria-label': UI.pickerLabel } });
		upload.disabled = this.busy;
		upload.addEventListener('change', () => { void this.selectFiles(Array.from(upload.files ?? [])); });
		new Setting(el).setName('Include tag thoughts as notes').setDesc('Kind 4 thoughts supply tags even when their notes are off.').addToggle((t) => t.setValue(this.options.includeTagThoughts).setDisabled(this.busy).onChange((value) => { this.options.includeTagThoughts = value; this.draw(); }));
		const extrasEl = el.createEl('details', { cls: 'thebrain-extras' });
		extrasEl.open = isPro();
		extrasEl.createEl('summary', { text: UI.extrasHeading });
		extrasEl.createEl('p', { text: isPro() ? 'Pro is active. Choose the extras for this import.' : 'The linked notes are free. These extras need Pro. Sign in with GitHub in the plugin tab.' });
		for (const [key, label] of [['bodies', 'Note bodies (Pro)'], ['attachments', 'Attachment files (Pro)'], ['canvas', 'Canvas file (Pro)']] as const) {
			new Setting(extrasEl).setName(label).addToggle((toggle) => toggle.setValue(isPro() && this.options[key]).setDisabled(this.busy || !isPro()).onChange((value) => { this.options[key] = value; }));
		}
		if (this.error) el.createEl('p', { text: this.error, cls: 'thebrain-error', attr: { role: 'alert' } });
		if (this.busy) { el.createEl('p', { text: 'Import in progress…', attr: { role: 'status' } }); return; }
		if (!this.source) return;
		try {
			const plan = makePlan(this.source, this.options.includeTagThoughts);
			new Setting(el).setName('Preview').setHeading();
			const summary = el.createDiv({ cls: 'thebrain-preview', attr: { role: 'status' } });
			summary.createEl('p', { text: `${plan.notes.length} notes · ${this.source.links.length} link records · ${plan.tagThoughts} tag thoughts` });
			summary.createEl('p', { text: `${plan.brokenEndpoints} broken endpoints · ${plan.duplicateNames.length} duplicate names · ${plan.skippedRelations} other link records · ${plan.skippedTagLinks} links to omitted tags` });
			summary.createEl('p', { text: `${plan.bodyCount} available note bodies · ${this.source.attachments.length} attachment entries (${planAttachments(this.source, plan).skipped} unavailable)` });
			summary.createEl('p', { text: `New folder: ${importFolder(this.app.vault)}` });
			if (plan.duplicateNames.length) summary.createEl('p', { text: `Names with suffixes: ${plan.duplicateNames.slice(0, 20).join(', ')}` });
			const list = summary.createEl('ul');
			for (const note of plan.notes.slice(0, 5)) list.createEl('li', { text: note.file });
			if (plan.notes.length > 5) list.createEl('li', { text: `… ${plan.notes.length - 5} more notes` });
			el.appendChild(extrasEl);
			new Setting(el).addButton((b) => b.setButtonText('Import to new folder').setCta().setDisabled(plan.notes.length === 0).onClick(() => this.startImport()));
		} catch (error) { el.createEl('p', { text: error instanceof Error ? error.message : String(error), attr: { role: 'alert' } }); }
	}
	async startImport(): Promise<void> {
		if (this.busy || !this.source) return;
		this.busy = true;
		this.error = '';
		this.draw();
		try {
			this.report = await this.plugin.importSource(this.source, this.options);
			this.plugin.settings = { ...this.options };
			await this.plugin.saveSettings();
			new Notice(`Imported ${this.report.notes} notes into ${this.report.folder}.`);
		} catch (error) { this.error = error instanceof Error ? error.message : String(error); new Notice(this.error); }
		finally { this.busy = false; this.draw(); }
	}
}
