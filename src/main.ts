import { Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, resetPro, isPro } from './pro';
import { DEFAULT_SETTINGS, TheBrainImportSettingTab, normalizeSettings, type ImportSettings } from './settings';
import { ImportModal } from './modal';
import { makePlan, type BrainSource } from './brain';
import { writeImport, type ImportReport } from './writer';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class TheBrainImportPlugin extends Plugin {
	settings: ImportSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private modal: ImportModal | null = null;
	private importing = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new TheBrainImportSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'import', name: 'Import thoughts and links', callback: () => this.openImport() });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.modal?.close(); resetPro(); }
	openImport(source?: BrainSource): ImportModal {
		this.modal?.close();
		this.modal = new ImportModal(this, source);
		this.modal.open();
		return this.modal;
	}
	async importSource(source: BrainSource, options: ImportSettings): Promise<ImportReport> {
		if (this.importing) throw new Error('An import is in progress.');
		this.importing = true;
		try {
			// Check the cached Sponsors state at the write boundary.
			return await writeImport(this.app.vault, source, makePlan(source, options.includeTagThoughts), options, isPro());
		} finally { this.importing = false; }
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<ImportSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
