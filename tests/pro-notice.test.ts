import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import TheBrainImportPlugin from '../src/main';
import { readJson } from '../src/brain';
import { PRO_EXTRAS, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Archive extras (Pro) toggles of the import window. Each select shows the shared Pro notice
// with the "Sponsor on GitHub" button, and the toggle shows off again. No extra is imported.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const LABELS = ['Note bodies (Pro)', 'Attachment files (Pro)', 'Canvas file (Pro)'];

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'thebrain-import' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new TheBrainImportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function (this: ToggleComponent) { toggles.push(this); });
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const importSource = vi.spyOn(plugin, 'importSource').mockResolvedValue({ folder: 'TheBrain import', notes: 1, bodies: 0, attachments: 0, canvas: false, brokenEndpoints: 0, skippedAttachments: 0 } as never);
	const saveSettings = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);
	const modal = plugin.openImport();
	await modal.selectFiles([
		new File(['[{"Id":"a","Name":"Plan"}]'], 'thoughts.json'),
		new File(['[]'], 'links.json'),
	]);
	return { plugin, modal, shown, importSource, saveSettings };
}
const toggles: ToggleComponent[] = [];
/** The drawn toggle of the setting row with this name. Each draw makes new rows, so look it up after each draw. */
function toggle(el: HTMLElement, name: string): ToggleComponent {
	const t = toggles.filter((c) => el.contains(c.toggleEl) && c.toggleEl.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent === name).pop();
	if (!t) throw new Error(`No toggle in the row "${name}".`);
	return t;
}
const isOn = (t: ToggleComponent) => t.getValue();

describe('Archive extras (Pro)', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); toggles.length = 0; });

	it('a free user who selects a Pro extra gets the Pro notice with a Sponsor button, the toggle shows off and the import has no extra', async () => {
		const { modal, shown, importSource } = await setup(false);
		const el = modal.contentEl;
		expect(el.querySelector('.thebrain-preview')?.textContent).toContain('1 notes');
		for (const name of LABELS) {
			expect(toggle(el, name).disabled).toBe(false);
			toggle(el, name).onClick();
			expect(isOn(toggle(el, name))).toBe(false);
		}
		expect(shown).toEqual(LABELS.map(() => ({ text: `${PRO_EXTRAS} ${PITCH}Sponsor on GitHub`, buttons: 1 })));
		// The free import runs with no extra.
		[...el.querySelectorAll('button')].find((b) => b.textContent === 'Import to new folder')!.click();
		await vi.waitFor(() => { expect(importSource).toHaveBeenCalledOnce(); });
		expect(importSource.mock.calls[0]![1]).toMatchObject({ bodies: false, attachments: false, canvas: false });
		modal.close();
	});

	it('a Pro user who selects a Pro extra turns it on, with no Pro notice', async () => {
		const { modal, shown, importSource } = await setup(true);
		const el = modal.contentEl;
		for (const name of LABELS) {
			const before = isOn(toggle(el, name));
			toggle(el, name).onClick();
			expect(isOn(toggle(el, name))).toBe(!before);
		}
		[...el.querySelectorAll('button')].find((b) => b.textContent === 'Import to new folder')!.click();
		await vi.waitFor(() => { expect(importSource).toHaveBeenCalledOnce(); });
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
