import { describe, it, expect } from 'vitest';
import vectors from './vectors/thebrain-import.json';
import { evaluateCase } from '../src/brain';

describe('golden acceptance cases', () => {
	it('has at least 20 vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		if ('error' in c.expected) expect(() => evaluateCase(c.args[0]!)).toThrow(String(c.expected.error));
		else expect(evaluateCase(c.args[0]!)).toMatchObject(c.expected);
	});
});
