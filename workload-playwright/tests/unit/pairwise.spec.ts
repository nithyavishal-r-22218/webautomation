import { test, expect } from '@playwright/test';
import { pairwise } from '../../src/createChecks';

const F = {
  viewType: ['bar', 'heatmap', 'timeline'], unit: ['days', 'weeks', 'months'],
  label: ['No Legend', 'Allocated Hours', 'Allocated Man Weeks'], grouping: ['None', 'Roles'], order: ['Asc', 'Desc'],
} as const;
const valid = (c: Record<string, unknown>) => !(c.label === 'Allocated Man Weeks' && c.unit === 'days') && !(c.grouping === 'None' && c.order === 'Desc');

test('pairwise covers every valid pair and never emits an invalid case', () => {
  const cases = pairwise(F, valid);
  const keys = Object.keys(F) as (keyof typeof F)[];
  for (const c of cases) expect(valid(c), JSON.stringify(c)).toBe(true);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++)
    for (const a of F[keys[i]!]) for (const b of F[keys[j]!]) {
      if (!valid({ [keys[i]!]: a, [keys[j]!]: b })) continue;
      expect(cases.some(c => c[keys[i]!] === a && c[keys[j]!] === b), `${keys[i]}=${a} with ${keys[j]}=${b}`).toBe(true);
    }
  // far fewer than the full product (3·3·3·2·2 = 108)
  expect(cases.length).toBeLessThan(30);
});

test('pairwise is deterministic', () => {
  expect(JSON.stringify(pairwise(F, valid))).toBe(JSON.stringify(pairwise(F, valid)));
});
