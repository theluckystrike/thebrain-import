import { describe, expect, it } from 'vitest';
import { makePlan, planAttachments, readJson, safeStem } from '../src/brain';
import { noteMarkdown } from '../src/writer';

describe('review file names', () => {
	it('does not make a hidden file from a leading dot', () => {
		expect(safeStem('.NET')).toBe('NET');
		expect(safeStem(' . config')).toBe('config');
	});
	it('does not split a character or end with a dot at the length limit', () => {
		const emoji = `${'a'.repeat(99)}😀b`;
		expect(safeStem(emoji)).toBe(`${'a'.repeat(99)}😀`);
		expect(safeStem(`${'a'.repeat(99)}.b`)).toBe('a'.repeat(99));
	});
	it('keeps a long CJK name under the 255 byte file name limit', () => {
		const file = `${safeStem('啊'.repeat(100))} (2).md`;
		expect(new TextEncoder().encode(file).length).toBeLessThanOrEqual(255);
		expect(safeStem('啊'.repeat(100))).toBe('啊'.repeat(60));
	});
});

describe('review attachment names', () => {
	it('does not end an attachment file with a dot', () => {
		const source = readJson(JSON.stringify([{ Id: 'a', Name: 'A' }]), '[]');
		source.files = { 'a/Attachments/foo.': new Uint8Array([1]) };
		source.attachments = [{ Id: 'x', ThoughtId: 'a', Name: 'foo.' }];
		expect(planAttachments(source, makePlan(source)).files.map((f) => f.file)).toEqual(['foo']);
	});
});

describe('review large import', () => {
	it('writes the text of 10,000 linked notes in linear time', () => {
		const thoughts = Array.from({ length: 10000 }, (_, i) => ({ Id: `t${i}`, Name: `Thought ${i}` }));
		const links = Array.from({ length: 9999 }, (_, i) => ({ ThoughtIdA: `t${i}`, ThoughtIdB: `t${i + 1}`, Relation: 1 }));
		const plan = makePlan(readJson(JSON.stringify(thoughts), JSON.stringify(links)));
		const start = performance.now();
		const text = plan.notes.map((note) => noteMarkdown(plan, note.id, 'F', false, []));
		expect(performance.now() - start).toBeLessThan(20000);
		expect(text[1]).toContain('- [[F/Thought 0|Thought 0]]');
		expect(text[1]).toContain('- [[F/Thought 2|Thought 2]]');
	});
});

describe('review note bodies', () => {
	it('keeps the indentation of the first body line', () => {
		const source = readJson(JSON.stringify([{ Id: 'a', Name: 'A' }]), '[]');
		source.files = { 'a/Notes/notes.md': new TextEncoder().encode('\n    indented code\ntext\n\n') };
		expect(noteMarkdown(makePlan(source), 'a', 'F', true, [])).toContain('## Notes\n\n    indented code\ntext\n\n## Parents');
	});
});
