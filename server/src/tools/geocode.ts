import { z } from 'zod';
import type { MapProvider, Tool } from '../types';

const schema = z.object({
  address: z.string().optional(),
  location: z.object({ lng: z.number(), lat: z.number() }).optional(),
});

export function createGeocodeTool(map: MapProvider): Tool {
  return {
    name: 'geocode',
    definition: {
      type: 'function',
      function: {
        name: 'geocode',
        description: '地址与坐标互转。给 address 返回坐标（正地理编码）；给 location 返回地址（逆地理编码）。',
        parameters: {
          type: 'object',
          properties: {
            address: { type: 'string', description: '要解析为坐标的地名/地址，如"三里屯"' },
            location: {
              type: 'object',
              description: '要解析为地址的坐标',
              properties: { lng: { type: 'number' }, lat: { type: 'number' } },
              required: ['lng', 'lat'],
            },
          },
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      if (parsed.address) {
        const results = await map.geocode(parsed.address);
        return { mode: 'forward' as const, address: parsed.address, results };
      }
      if (parsed.location) {
        const result = await map.reverseGeocode(parsed.location);
        return { mode: 'reverse' as const, location: parsed.location, result };
      }
      return { error: '需要提供 address 或 location' };
    },
  };
}
