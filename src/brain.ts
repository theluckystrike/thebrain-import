import { unzipSync, strFromU8 } from 'fflate';

export type RecordData = Record<string, unknown>;
export interface BrainSource {
	thoughts: RecordData[];
	links: RecordData[];
	attachments: RecordData[];
	files: Record<string, Uint8Array>;
}
export interface BrainNote {
	id: string;
	name: string;
	file: string;
	frontmatter: RecordData;
	parents: string[];
	children: string[];
	jumps: string[];
	body: string;
}
export interface BrainPlan {
	notes: BrainNote[];
	brokenEndpoints: number;
	duplicateNames: string[];
	skippedRelations: number;
	skippedTagLinks: number;
	tagThoughts: number;
	bodyCount: number;
}
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_RECORDS = 10000;

export function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Read a JSON array or one JSON object per line. */
export function records(input: string, label: string): RecordData[] {
	const clean = input.replace(/^\uFEFF/, '').trim();
	if (!clean) return [];
	let rows: unknown[];
	try {
		rows = clean.startsWith('[') ? JSON.parse(clean) as unknown[] : clean.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown);
	} catch {
		throw new Error(`${label}: invalid JSON. Use an array or one object per line.`);
	}
	if (!Array.isArray(rows) || rows.length > MAX_RECORDS) throw new Error(`${label}: use at most ${MAX_RECORDS} records.`);
	return rows.map((row) => {
		if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label}: each record must be an object.`);
		return row as RecordData;
	});
}

export function readJson(thoughts: string, links: string): BrainSource {
	return { thoughts: records(thoughts, 'thoughts.json'), links: records(links, 'links.json'), attachments: [], files: {} };
}

/** Archive paths are relative and do not name a parent folder. */
export function archivePath(path: string): string | null {
	if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.includes('\0')) return null;
	if (path.split('/').some((part) => part === '..' || part === '.')) return null;
	return path;
}

export function readArchive(bytes: Uint8Array): BrainSource {
	if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('Archive exceeds 50 MB.');
	let total = 0;
	let count = 0;
	const files = unzipSync(bytes, { filter: (file) => {
		count++;
		total += file.originalSize;
		if (count > MAX_RECORDS || total > MAX_EXPANDED_BYTES || file.originalSize > MAX_INPUT_BYTES) throw new Error('Archive exceeds the expanded size or entry limit.');
		if (!archivePath(file.name)) throw new Error('Archive contains an unsafe path.');
		return !file.name.endsWith('/');
	} });
	const get = (name: string): string => {
		const data = files[name];
		if (!data) throw new Error(`Archive needs ${name} at its root.`);
		return strFromU8(data);
	};
	return { ...readJson(get('thoughts.json'), get('links.json')), attachments: files['attachments.json'] ? records(strFromU8(files['attachments.json']), 'attachments.json') : [], files };
}

/** File stems exclude Markdown link syntax and file system reserved characters. */
export function safeStem(value: string): string {
	const clean = Array.from(value.normalize('NFC'), (c) => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|#[\]^]/g, ' ').replace(/\s+/g, ' ');
	// Cut by code point to 100 characters and 180 UTF-8 bytes, so a suffix and .md stay under the 255 byte name limit.
	let cut = '';
	let bytes = 0;
	for (const c of Array.from(clean.trim()).slice(0, 100)) {
		bytes += new TextEncoder().encode(c).length;
		if (bytes > 180) break;
		cut += c;
	}
	// A leading dot makes a hidden file that the vault ignores.
	let stem = cut.replace(/^[. ]+|[. ]+$/g, '');
	if (!stem || /^\.+$/.test(stem)) stem = 'Untitled';
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
	return stem;
}

export function tagName(value: string): string {
	const tag = value.normalize('NFC').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '').replace(/^\/+|\/+$/g, '');
	return /^\d+$/.test(tag) ? `tag-${tag}` : tag;
}

export function makePlan(source: BrainSource, includeTagThoughts = false): BrainPlan {
	const thoughts = new Map<string, RecordData>();
	for (const thought of source.thoughts) {
		const id = text(thought.Id);
		if (!id || thoughts.has(id)) throw new Error('Thought IDs must be present and unique.');
		thoughts.set(id, thought);
	}
	const notes: BrainNote[] = [];
	const byId = new Map<string, BrainNote>();
	const used = new Set<string>();
	const duplicateNames = new Set<string>();
	let tagThoughts = 0;
	for (const [id, thought] of thoughts) {
		if (thought.Kind === 4) {
			tagThoughts++;
			if (!includeTagThoughts) continue;
		}
		const name = text(thought.Name) || 'Untitled';
		const stem = safeStem(name);
		let file = stem;
		for (let n = 2; used.has(file.toLowerCase()); n++) {
			duplicateNames.add(stem);
			file = `${stem} (${n})`;
		}
		used.add(file.toLowerCase());
		const tags = new Set<string>();
		if (Array.isArray(thought.TagIds)) for (const tagId of thought.TagIds) {
			const tag = thoughts.get(text(tagId));
			if (tag?.Kind === 4) {
				const name = tagName(text(tag.Name));
				if (name) tags.add(name);
			}
		}
		const frontmatter: RecordData = { thebrain_id: id, label: text(thought.Label), tags: [...tags], created: text(thought.CreationDateTime), modified: text(thought.ModificationDateTime) };
		const bodyPath = archivePath(`${id}/Notes/notes.md`);
		const bodyBytes = bodyPath ? source.files[bodyPath] : undefined;
		const body = bodyBytes ? strFromU8(bodyBytes).replace(/^\uFEFF/, '') : '';
		// A body with only white space is empty. It gets no count and no Notes heading.
		const note: BrainNote = { id, name, file: `${file}.md`, frontmatter, parents: [], children: [], jumps: [], body: body.trim() ? body : '' };
		notes.push(note);
		byId.set(id, note);
	}
	let brokenEndpoints = 0;
	let skippedRelations = 0;
	let skippedTagLinks = 0;
	const add = (values: string[], id: string) => { if (!values.includes(id)) values.push(id); };
	for (const link of source.links) {
		// Link type records have no thought endpoints.
		if (link.Kind === 2 || link.Meaning === 0) { skippedRelations++; continue; }
		const aid = text(link.ThoughtIdA);
		const bid = text(link.ThoughtIdB);
		const missing = Number(!thoughts.has(aid)) + Number(!thoughts.has(bid));
		brokenEndpoints += missing;
		if (missing) continue;
		const a = byId.get(aid);
		const b = byId.get(bid);
		if (!a || !b) { skippedTagLinks++; continue; }
		if (link.Relation === 1) { add(a.children, bid); add(b.parents, aid); }
		else if (link.Relation === 3) { add(a.jumps, bid); add(b.jumps, aid); }
		else skippedRelations++;
	}
	return { notes, brokenEndpoints, duplicateNames: [...duplicateNames], skippedRelations, skippedTagLinks, tagThoughts, bodyCount: notes.filter((n) => n.body !== '').length };
}

export interface AttachmentPlan {
	id: string;
	thoughtId: string;
	file: string;
	bytes: Uint8Array;
}

/** Copy only local files named by a supported attachment entry. */
export function planAttachments(source: BrainSource, plan: BrainPlan): { files: AttachmentPlan[]; skipped: number } {
	const files: AttachmentPlan[] = [];
	let skipped = 0;
	const used = new Set<string>();
	const noteIds = new Set(plan.notes.map((note) => note.id));
	for (const row of source.attachments) {
		const thoughtId = text(row.ThoughtId);
		const id = text(row.Id);
		const name = text(row.Name) || text(row.FileName);
		const explicit = text(row.Path);
		const candidates = explicit ? [explicit] : [`${thoughtId}/Attachments/${id}/${name}`, `${thoughtId}/Attachments/${name}`, `${thoughtId}/Attachments/${id}`];
		const path = candidates.find((path) => archivePath(path) !== null && Object.prototype.hasOwnProperty.call(source.files, path));
		if (!noteIds.has(thoughtId) || !name || !path) { skipped++; continue; }
		const dot = name.lastIndexOf('.');
		const ext = dot > 0 ? name.slice(dot).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16).replace(/^\.+$/, '') : '';
		const base = safeStem(dot > 0 ? name.slice(0, dot) : name);
		let file = `${base}${ext}`;
		for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} (${n})${ext}`;
		used.add(file.toLowerCase());
		files.push({ id, thoughtId, file, bytes: source.files[path]! });
	}
	return { files, skipped };
}

export function nextFolder(exists: (path: string) => boolean): string {
	let folder = 'TheBrain import';
	for (let n = 2; exists(folder); n++) folder = `TheBrain import ${n}`;
	return folder;
}

export function canvasData(plan: BrainPlan, folder: string): string {
	const nodeIds = new Map(plan.notes.map((note, i) => [note.id, `n${i}`]));
	const nodes = plan.notes.map((note, i) => ({ id: `n${i}`, type: 'file', file: `${folder}/${note.file}`, x: (i % 5) * 340, y: Math.floor(i / 5) * 220, width: 300, height: 160 }));
	const edges: RecordData[] = [];
	const seenJumps = new Set<string>();
	for (const note of plan.notes) {
		for (const target of note.children) edges.push({ id: `e${edges.length}`, fromNode: nodeIds.get(note.id), fromSide: 'bottom', toNode: nodeIds.get(target), toSide: 'top', label: 'Child' });
		for (const target of note.jumps) {
			const key = [note.id, target].sort().join('\0');
			if (seenJumps.has(key)) continue;
			seenJumps.add(key);
			edges.push({ id: `e${edges.length}`, fromNode: nodeIds.get(note.id), fromSide: 'right', toNode: nodeIds.get(target), toSide: 'left', toEnd: 'none', label: 'Jump' });
		}
	}
	return JSON.stringify({ nodes, edges }, null, 2);
}

/** Golden cases can use JSON text or a base64 archive. */
export function evaluateCase(input: { thoughts?: string; links?: string; archive?: string; includeTags?: boolean; occupied?: string[] }): RecordData {
	const source = input.archive ? readArchive(Uint8Array.from(atob(input.archive), (c) => c.charCodeAt(0))) : readJson(input.thoughts ?? '', input.links ?? '');
	const plan = makePlan(source, input.includeTags);
	return { ...plan, folder: nextFolder((path) => (input.occupied ?? []).some((name) => name.toLowerCase() === path.toLowerCase())), names: plan.notes.map((note) => note.file) };
}
