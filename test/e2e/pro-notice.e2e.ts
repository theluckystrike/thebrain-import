import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select the Archive extras (Pro) toggles of the import window. The select shows the shared Pro
// notice with the "Sponsor on GitHub" button, and the toggle shows off again. A Pro user turns the toggle on.
interface TestModal { selectFiles(files: File[]): Promise<void>; close(): void; contentEl: HTMLElement }
type Host = { plugins: { plugins: Record<string, { pro: SponsorsManager; openImport(): TestModal }> } };
const LEAD = 'Note bodies, attachment files and the Canvas file need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled, id) => {
		const pro = (app as unknown as Host).plugins.plugins[id]!.pro;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on, pluginId);
}

/** Opens the import window with a 1 thought export, selects Note bodies (Pro), then reads the toggle and the notices. */
async function selectBodies() {
	return browser.executeObsidian(async ({ app }, id) => {
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		const modal = (app as unknown as Host).plugins.plugins[id]!.openImport();
		await modal.selectFiles([new File(['[{"Id":"a","Name":"Plan"}]'], 'thoughts.json'), new File(['[]'], 'links.json')]);
		const row = () => [...modal.contentEl.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Note bodies (Pro)');
		const box = row()?.querySelector('.checkbox-container') as HTMLElement | null;
		const disabled = box?.classList.contains('is-disabled') ?? null;
		const before = box?.classList.contains('is-enabled') ?? null;
		box?.click();
		await new Promise((r) => setTimeout(r, 300));
		const result = {
			disabled,
			before,
			on: row()?.querySelector('.checkbox-container')?.classList.contains('is-enabled') ?? null,
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
		};
		modal.close();
		return result;
	}, pluginId);
}

describe('Archive extras (Pro)', function () {
	afterEach(async () => { await setPro(false); });

	it('a free user who selects Note bodies gets a Pro notice with a Sponsor button, and the toggle shows off', async () => {
		expect(await setPro(false)).toBe(false);
		const after = await selectBodies();
		expect(after.disabled).toBe(false);
		if (!after.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Note bodies: ${JSON.stringify(after.notices)}`);
		expect(after.on).toBe(false);
	});

	it('a Pro user who selects Note bodies turns it on, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		const after = await selectBodies();
		expect(after.on).toBe(!after.before);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
