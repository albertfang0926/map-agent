import { describe, it, expect, vi } from 'vitest';
import { createGeocodeTool } from './geocode';
import type { MapProvider } from '../types';

describe('geocode 工具', () => {
  it('正地理编码：地址→坐标', async () => {
    const map = {
      geocode: vi.fn().mockResolvedValue([
        { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区三里屯' },
      ]),
      reverseGeocode: vi.fn(),
    } as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({ address: '三里屯' });
    expect(map.geocode).toHaveBeenCalledWith('三里屯');
    expect(result).toEqual({
      mode: 'forward',
      address: '三里屯',
      results: [{ location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区三里屯' }],
    });
  });

  it('逆地理编码：坐标→地址', async () => {
    const map = {
      geocode: vi.fn(),
      reverseGeocode: vi.fn().mockResolvedValue({ location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区' }),
    } as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({ location: { lng: 116.48, lat: 39.99 } });
    expect(map.reverseGeocode).toHaveBeenCalledWith({ lng: 116.48, lat: 39.99 });
    expect(result).toEqual({
      mode: 'reverse',
      location: { lng: 116.48, lat: 39.99 },
      result: { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区' },
    });
  });

  it('缺少 address 与 location 时返回错误', async () => {
    const map = {} as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({});
    expect(result).toEqual({ error: '需要提供 address 或 location' });
  });

  it('工具定义名称为 geocode', () => {
    const tool = createGeocodeTool({} as unknown as MapProvider);
    expect(tool.name).toBe('geocode');
    expect(tool.definition.function.name).toBe('geocode');
  });
});
