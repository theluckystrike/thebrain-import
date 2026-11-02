import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { MAX_INPUT_BYTES, archivePath, canvasData, makePlan, planAttachments, readArchive, readJson, records, safeStem } from '../src/brain';

const t = [{ Id: 'a', Name: 'Alpha' }, { Id: 'b', Name: 'Beta' }];
function archive(extra: Record<string, Uint8Array> = {}) {
	return zipSync({ 'thoughts.json': strToU8(JSON.stringify(t)), 'links.json': strToU8(JSON.stringify([{ ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 1 }])), ...extra });
}
describe('public sample', () => {
	it('reads the archive and JSON pair with the same thought IDs and relation endpoints', () => {
		const base = 'tests/fixtures/';
		const pair = readJson(readFileSync(base + 'brain-thoughts-fixture.json', 'utf8'), readFileSync(base + 'brain-links-fixture.json', 'utf8'));
		const zipped = readArchive(readFileSync(base + 'brain-test-archive.brz'));
		const list = (source: typeof pair) => makePlan(source).notes.map(({ id, parents, children, jumps }) => ({ id, parents, children, jumps }));
		expect(list(pair)).toEqual(list(zipped));
		expect(list(pair)).toHaveLength(20);
	});
});
describe('archive limits and paths', () => {
	it('rejects invalid and incomplete archives', () => {
		expect(() => readArchive(new Uint8Array([1, 2, 3]))).toThrow();
		expect(() => readArchive(zipSync({}))).toThrow('needs thoughts.json');
	});
	it('rejects unsafe paths even in files not used by the import', () => {
		for (const path of ['../outside', '/outside', 'C:/outside', 'a/../outside', 'a\\outside']) {
			expect(archivePath(path)).toBeNull();
			expect(() => readArchive(archive({ [path]: strToU8('bad') }))).toThrow('unsafe path');
		}
	});
	it('rejects input and expanded file limits before copying', () => {
		expect(() => readArchive(new Uint8Array(MAX_INPUT_BYTES + 1))).toThrow('50 MB');
		// Patch the central directory original size. No decompression of the claimed huge file occurs.
		const bytes = archive();
		const view = new DataView(bytes.buffer);
		for (let i = 0; i < bytes.length - 28; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, MAX_INPUT_BYTES + 1, true); break; }
		expect(() => readArchive(bytes)).toThrow('expanded size');
	});
	it('accepts array JSON, blank input and CRLF line records', () => {
		expect(records(' \uFEFF\n', 'sample')).toEqual([]);
		expect(records('\uFEFF{"Id":"a"}\r\n\r\n{"Id":"b"}\r\n', 'sample')).toHaveLength(2);
		expect(() => records(JSON.stringify(Array(10001).fill({})), 'sample')).toThrow('10000');
	});
	it('cleans control characters and canonical Unicode name collisions', () => {
		expect(safeStem('A\nB\0C.')).toBe('A B C');
		const source = readJson(JSON.stringify([{ Id: 'a', Name: 'é' }, { Id: 'b', Name: 'e\u0301' }]), '[]');
		expect(makePlan(source).notes.map((n) => n.file)).toEqual(['é.md', 'é (2).md']);
	});
});
describe('archive extras', () => {
	it('reads a BOM-prefixed note body only from the thought note path', () => {
		const source = readArchive(archive({ 'a/Notes/notes.md': strToU8('\uFEFF# Source body\n'), 'b/notes.md': strToU8('not the expected path') }));
		expect(makePlan(source).bodyCount).toBe(1);
		expect(makePlan(source).notes[0]!.body).toBe('# Source body\n');
	});
	it('copies matching attachment entries with safe names and reports missing or external files', () => {
		const entries = [
			{ Id: '1', ThoughtId: 'a', Name: 'Map.pdf', Path: 'a/Attachments/map.pdf' },
			{ Id: '2', ThoughtId: 'b', Name: 'Map.pdf', Path: 'a/Attachments/map.pdf' },
			{ Id: '3', ThoughtId: 'missing', Name: 'Map.pdf', Path: 'a/Attachments/map.pdf' },
			{ Id: '4', ThoughtId: 'a', Name: 'Remote.pdf', Path: 'https://example.invalid/file' },
			{ Id: '5', ThoughtId: 'a', Name: 'Missing.pdf', Path: '../outside' },
		];
		const source = readArchive(archive({ 'attachments.json': strToU8(JSON.stringify(entries)), 'a/Attachments/map.pdf': new Uint8Array([1, 2, 3]) }));
		const result = planAttachments(source, makePlan(source));
		expect(result.files.map((f) => f.file)).toEqual(['Map.pdf', 'Map (2).pdf']);
		expect(result.files[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
		// Entry 4 is a web link, so it is not a skipped file.
		expect(result.skipped).toBe(2);
		expect(makePlan(source).notes[0]!.links).toEqual([{ name: 'Remote.pdf', url: 'https://example.invalid/file' }]);
	});
	it('reads notes and web links from a real TheBrain export layout', () => {
		const entries = [
			{ Id: 'n1', SourceId: 'a', SourceType: 2, Type: 1, NoteType: 4, Location: 'Notes.md', Name: 'Notes.md' },
			{ Id: 'u1', SourceId: 'a', SourceType: 2, Type: 3, NoteType: 0, Location: 'https://www.thebrain.com/', Name: 'TheBrain home' },
			{ Id: 'u2', SourceId: 'a', SourceType: 2, Type: 3, NoteType: 0, Location: 'example.org/page', Name: '' },
			{ Id: 'f1', SourceId: 'a', SourceType: 2, Type: 1, NoteType: 0, Location: 'Report.pdf', Name: 'Report.pdf' },
			{ Id: 'i1', SourceId: 'a', SourceType: 2, Type: 12, NoteType: 0, Location: 'pic.png', Name: 'pic.png' },
			{ Id: 'h1', SourceId: 'b', SourceType: 2, Type: 4, NoteType: 2, Location: 'notes.html', Name: 'notes.html' },
		];
		const source = readArchive(archive({
			'attachments.json': strToU8('\uFEFF' + entries.map((e) => JSON.stringify(e)).join('\n')),
			'a/Notes.md': strToU8('\uFEFFThought body text'),
			'a/Report.pdf': new Uint8Array([7]),
			'a/.data/md-images/pic.png': new Uint8Array([8]),
			'b/Notes/notes.html': strToU8('<?xml version="1.0"?><html><head><style>p{}</style></head><body><p>Old note</p></body></html>'),
		}));
		const plan = makePlan(source);
		expect(plan.notes.map((n) => n.body)).toEqual(['Thought body text', '<p>Old note</p>']);
		expect(plan.bodyCount).toBe(2);
		expect(plan.notes[0]!.links).toEqual([{ name: 'TheBrain home', url: 'https://www.thebrain.com/' }, { name: 'https://example.org/page', url: 'https://example.org/page' }]);
		expect(plan.linkCount).toBe(2);
		const files = planAttachments(source, plan);
		expect(files.files.map((f) => f.file)).toEqual(['Report.pdf']);
		expect(files.skipped).toBe(0);
	});
	it('keeps only web schemes as links', () => {
		const entries = [{ SourceId: 'a', Type: 3, Location: 'javascript:alert(1)' }, { SourceId: 'a', Type: 3, Location: 'mailto:a@example.org', Name: 'Mail' }];
		const plan = makePlan(readArchive(archive({ 'attachments.json': strToU8(JSON.stringify(entries)) })));
		expect(plan.notes[0]!.links).toEqual([{ name: 'Mail', url: 'mailto:a@example.org' }]);
	});
	it('finds the documented attachment layouts without a Path', () => {
		const entries = [{ Id: 'x', ThoughtId: 'a', Name: 'Map.txt' }, { Id: 'y', ThoughtId: 'b', FileName: 'Guide.txt' }];
		const source = readArchive(archive({ 'attachments.json': strToU8(JSON.stringify(entries)), 'a/Attachments/x/Map.txt': strToU8('map'), 'b/Attachments/y': strToU8('guide') }));
		expect(planAttachments(source, makePlan(source)).files.map((f) => f.file)).toEqual(['Map.txt', 'Guide.txt']);
	});
	it('places Canvas file nodes and deduplicates mutual jumps', () => {
		const plan = makePlan(readJson(JSON.stringify(t), JSON.stringify([{ ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 1 }, { ThoughtIdA: 'a', ThoughtIdB: 'b', Relation: 3 }, { ThoughtIdA: 'b', ThoughtIdB: 'a', Relation: 3 }])));
		const data = JSON.parse(canvasData(plan, 'TheBrain import'));
		expect(data.nodes).toHaveLength(2);
		expect(data.nodes[0]).toMatchObject({ file: 'TheBrain import/Alpha.md', x: 0, y: 0 });
		expect(data.edges).toHaveLength(2);
		expect(data.edges[1]).toMatchObject({ label: 'Jump', toEnd: 'none' });
	});
});
