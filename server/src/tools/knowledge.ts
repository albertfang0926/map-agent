import { z } from 'zod';
import type { LngLat, MapProvider, Tool } from '../types';

const schema = z.object({
  reference: z.string().optional(),
  places: z.array(z.string()).min(1),
});

const TO_RAD = (d: number) => (d * Math.PI) / 180;
const TO_DEG = (r: number) => (r * 180) / Math.PI;

function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const dLat = TO_RAD(b.lat - a.lat);
  const dLng = TO_RAD(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(TO_RAD(a.lat)) * Math.cos(TO_RAD(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function bearing(a: LngLat, b: LngLat): number {
  const dLng = TO_RAD(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(TO_RAD(b.lat));
  const x = Math.cos(TO_RAD(a.lat)) * Math.sin(TO_RAD(b.lat)) - Math.sin(TO_RAD(a.lat)) * Math.cos(TO_RAD(b.lat)) * Math.cos(dLng);
  return (TO_DEG(Math.atan2(y, x)) + 360) % 360;
}

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
function compass(b: number): string {
  return DIRS[Math.round(b / 45) % 8];
}

export function createSpatialTool(map: MapProvider): Tool {
  return {
    name: 'spatial_query',
    definition: {
      type: 'function',
      function: {
        name: 'spatial_query',
        description: '分析地理空间关系：给定参考地与若干地点，计算每个地点相对参考地的直线距离（公里）与方位（8 点罗盘），并指出最近的一个。用于回答「X 在 Y 的什么方向」「哪个最近」。',
        parameters: {
          type: 'object',
          properties: {
            reference: { type: 'string', description: '参考地名；省略时以 places[0] 为参考' },
            places: { type: 'array', items: { type: 'string' }, description: '待分析的地点名列表' },
          },
          required: ['places'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const refName = parsed.reference ?? parsed.places[0];
      const refResults = await map.geocode(refName);
      const refLoc = refResults[0]?.location;
      if (!refLoc) return { error: `无法定位：${refName}` };

      const results: Array<{ place: string; location: LngLat; distanceKm: number; direction: string }> = [];
      let nearest: { place: string; distanceKm: number } | null = null;
      for (const place of parsed.places.filter((p) => p !== refName)) {
        const loc = (await map.geocode(place))[0]?.location;
        if (!loc) return { error: `无法定位：${place}` };
        const distanceKm = Math.round(haversineKm(refLoc, loc));
        const direction = compass(bearing(refLoc, loc));
        results.push({ place, location: loc, distanceKm, direction });
        if (!nearest || distanceKm < nearest.distanceKm) nearest = { place, distanceKm };
      }
      return {
        reference: refName,
        referenceLocation: refLoc,
        results,
        nearest: nearest?.place ?? refName,
      };
    },
  };
}
