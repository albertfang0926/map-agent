import type { ItineraryDayDraft, LngLat, MapPOI } from '../types';

function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function score(poi: MapPOI, preferences: Record<string, string>): number {
  let s = 0;
  const hay = `${poi.name} ${poi.typecode ?? ''}`.toLowerCase();
  for (const v of Object.values(preferences)) {
    if (v && hay.includes(String(v).toLowerCase())) s += 1;
  }
  return s;
}

export function planItinerary(
  pois: MapPOI[],
  opts: { days: number; preferences?: Record<string, string> },
): ItineraryDayDraft[] {
  const days = Math.max(1, opts.days);
  const prefs = opts.preferences ?? {};

  // 1. 打分后按分数降序（稳定：分数相同保持原顺序）
  const ordered = [...pois].sort((a, b) => score(b, prefs) - score(a, prefs));

  // 2. round-robin 分天
  const dayPlaces: MapPOI[][] = Array.from({ length: days }, () => []);
  ordered.forEach((p, i) => dayPlaces[i % days].push(p));

  // 3. 每天内贪心就近排序
  return dayPlaces.map((places, idx) => {
    const sorted: MapPOI[] = [];
    const remaining = [...places];
    while (remaining.length) {
      const last = sorted[sorted.length - 1];
      let pickIdx = 0;
      if (last) {
        let best = Infinity;
        for (let j = 0; j < remaining.length; j++) {
          const d = haversineKm(last.location, remaining[j].location);
          if (d < best) {
            best = d;
            pickIdx = j;
          }
        }
      }
      sorted.push(remaining.splice(pickIdx, 1)[0]);
    }
    return { day: idx + 1, places: sorted };
  });
}
