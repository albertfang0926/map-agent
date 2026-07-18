import { describe, it, expect } from 'vitest';
import { createLongTermMemory } from '../long_term';
import type { SavedPlace } from '../../types';

function mem() {
  return createLongTermMemory({ dbPath: ':memory:' });
}

describe('LongTermMemory (node:sqlite)', () => {
  it('setPreference / getPreference', async () => {
    const m = mem();
    expect(await m.getPreference('x')).toBeUndefined();
    await m.setPreference('travel_style', '人文');
    expect(await m.getPreference('travel_style')).toBe('人文');
  });

  it('getAllPreferences 返回多条', async () => {
    const m = mem();
    await m.setPreference('a', '1');
    await m.setPreference('b', '2');
    expect(await m.getAllPreferences()).toEqual({ a: '1', b: '2' });
  });

  it('setPreference 覆盖同 key', async () => {
    const m = mem();
    await m.setPreference('k', 'old');
    await m.setPreference('k', 'new');
    expect(await m.getPreference('k')).toBe('new');
    expect(Object.keys(await m.getAllPreferences())).toHaveLength(1);
  });

  it('savePlace / getPlaces 字段映射 + tags JSON', async () => {
    const m = mem();
    const place: SavedPlace = {
      id: 'p1', name: '外滩', location: { lng: 121.49, lat: 31.24 },
      address: '上海', tags: ['景点', '人文'], savedAt: '2026-07-18T00:00:00.000Z',
    };
    await m.savePlace(place);
    expect(await m.getPlaces()).toEqual([place]);
  });

  it('savePlace 覆盖同 id', async () => {
    const m = mem();
    await m.savePlace({ id: 'p1', name: '旧', location: { lng: 1, lat: 2 }, savedAt: 't1' });
    await m.savePlace({ id: 'p1', name: '新', location: { lng: 1, lat: 2 }, savedAt: 't2' });
    const got = await m.getPlaces();
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe('新');
  });

  it('getRecentSummaries limit 截断', async () => {
    const m = mem();
    await m.saveSummary('s1', '一', 2);
    await m.saveSummary('s2', '二', 4);
    expect(await m.getRecentSummaries(1)).toHaveLength(1);
    expect(await m.getRecentSummaries(10)).toHaveLength(2);
  });

  it('saveSummary 覆盖同 sessionId', async () => {
    const m = mem();
    await m.saveSummary('s1', 'old', 2);
    await m.saveSummary('s1', 'new', 5);
    const got = await m.getRecentSummaries(10);
    expect(got).toHaveLength(1);
    expect(got[0].summary).toBe('new');
    expect(got[0].messageCount).toBe(5);
  });
});
