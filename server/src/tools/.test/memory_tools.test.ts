import { describe, it, expect, vi } from 'vitest';
import { createSavePlaceTool, createRememberPreferenceTool } from '../memory_tools';
import type { LongTermMemory } from '../../memory/long_term';

function mockMem() {
  return {
    savePlace: vi.fn().mockResolvedValue(undefined),
    setPreference: vi.fn().mockResolvedValue(undefined),
  } as unknown as LongTermMemory;
}

describe('save_place 工具', () => {
  it('写入 memory 并返回 saved（补 savedAt）', async () => {
    const mem = mockMem();
    const tool = createSavePlaceTool(mem);
    const result = await tool.execute({ id: 'p1', name: '外滩', location: { lng: 1, lat: 2 }, tags: ['人文'] });
    expect(mem.savePlace).toHaveBeenCalledOnce();
    expect(result).toEqual({ saved: 'p1' });
    const saved = (mem.savePlace as any).mock.calls[0][0];
    expect(saved.id).toBe('p1');
    expect(saved.savedAt).toEqual(expect.any(String));
  });

  it('工具定义名称为 save_place', () => {
    expect(createSavePlaceTool(mockMem()).name).toBe('save_place');
  });
});

describe('remember_preference 工具', () => {
  it('写入 memory 并返回 remembered', async () => {
    const mem = mockMem();
    const tool = createRememberPreferenceTool(mem);
    const result = await tool.execute({ key: 'travel_style', value: '人文' });
    expect(mem.setPreference).toHaveBeenCalledWith('travel_style', '人文');
    expect(result).toEqual({ remembered: 'travel_style' });
  });

  it('工具定义名称为 remember_preference', () => {
    expect(createRememberPreferenceTool(mockMem()).name).toBe('remember_preference');
  });
});
