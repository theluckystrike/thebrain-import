import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type TheBrainImportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface ImportSettings {
	includeTagThoughts: boolean;
	bodies: boolean;
	attachments: boolean;
	canvas: boolean;
}
export const DEFAULT_SETTINGS: ImportSettings = { includeTagThoughts: false, bodies: false, attachments: false, canvas: false };
export function normalizeSettings(saved: Partial<ImportSettings> | null | undefined): ImportSettings {
	const result = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(result) as (keyof ImportSettings)[]) {
		if (typeof saved?.[key] === 'boolean') result[key] = saved[key];
	}
	return result;
}
export class TheBrainImportSettingTab extends PluginSettingTab {
	plugin: TheBrainImportPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: TheBrainImportPlugin) { super(app, plugin); this.plugin = plugin; }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Include tag thoughts as notes', desc: 'Kind 4 thoughts supply tags. Turn this on to create their notes too.', control: { type: 'toggle', key: 'includeTagThoughts', defaultValue: false } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
