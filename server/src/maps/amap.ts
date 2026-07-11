import type { GeocodeResult, LngLat, MapProvider, MapPOI, RouteResult, RouteSegment } from '../types';

function parsePolyline(s: string): LngLat[] {
  return (s ?? '')
    .split(';')
    .filter(Boolean)
    .map((pt) => {
      const [lng, lat] = pt.split(',').map(Number);
      return { lng, lat };
    });
}

function cityOrUndefined(city: string | [] | undefined): string | undefined {
  return typeof city === 'string' && city.length ? city : undefined;
}

export function createAmapProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
}): MapProvider {
  const doFetch = opts.fetch ?? fetch;

  async function fetchJson(url: URL) {
    const res = await doFetch(url.toString());
    return (await res.json()) as { status: string; info?: string };
  }

  function ensureOk(json: { status: string; info?: string }) {
    if (json.status !== '1') throw new Error(`AMap error: ${json.info ?? 'unknown'}`);
  }

  return {
    async searchPoi({ keyword, city }) {
      const url = new URL('https://restapi.amap.com/v3/place/text');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('keywords', keyword);
      url.searchParams.set('offset', '10');
      if (city) url.searchParams.set('city', city);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        pois?: Array<{ id: string; name: string; location: string; address?: string; typecode?: string }>;
      };
      ensureOk(json);
      return (json.pois ?? []).map((p): MapPOI => {
        const [lng, lat] = (p.location ?? '0,0').split(',').map(Number);
        return { id: p.id, name: p.name, location: { lng, lat }, address: p.address, typecode: p.typecode };
      });
    },

    async geocode(address) {
      const url = new URL('https://restapi.amap.com/v3/geocode/geo');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('address', address);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        geocodes?: Array<{ location: string; formatted_address?: string; province?: string; city?: string | []; district?: string }>;
      };
      ensureOk(json);
      return (json.geocodes ?? []).map((g): GeocodeResult => {
        const [lng, lat] = (g.location ?? '0,0').split(',').map(Number);
        return { location: { lng, lat }, formattedAddress: g.formatted_address, province: g.province, city: cityOrUndefined(g.city), district: g.district };
      });
    },

    async reverseGeocode({ lng, lat }) {
      const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('location', `${lng},${lat}`);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        regeocode?: { formatted_address?: string; addressComponent?: { province?: string; city?: string | []; district?: string } };
      };
      ensureOk(json);
      const r = json.regeocode;
      const ac = r?.addressComponent ?? {};
      return {
        location: { lng, lat },
        formattedAddress: r?.formatted_address,
        province: ac.province,
        city: cityOrUndefined(ac.city),
        district: ac.district,
      };
    },

    async planRoute({ mode, origin, destination, waypoints, city }) {
      if (mode === 'transit') {
        const url = new URL('https://restapi.amap.com/v3/direction/transit/integrated');
        url.searchParams.set('key', opts.apiKey);
        url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
        url.searchParams.set('destination', `${destination.lng},${destination.lat}`);
        url.searchParams.set('city', city ?? '北京');
        const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
          route?: { transit?: { transits?: Array<{ distance?: string; duration?: string; segments?: Array<{ walking?: { steps?: Array<{ polyline?: string }> }; bus?: { buslines?: Array<{ name?: string; polyline?: string }> } }> }> } };
        };
        ensureOk(json);
        const t = json.route?.transit?.transits?.[0];
        if (!t) throw new Error('AMap error: no transit');
        const polyline: LngLat[] = [];
        const segments: RouteSegment[] = [];
        for (const seg of t.segments ?? []) {
          const pts: LngLat[] = [];
          for (const step of seg.walking?.steps ?? []) pts.push(...parsePolyline(step.polyline ?? ''));
          for (const bus of seg.bus?.buslines ?? []) pts.push(...parsePolyline(bus.polyline ?? ''));
          for (const pt of pts) {
            const last = polyline[polyline.length - 1];
            if (!last || last.lng !== pt.lng || last.lat !== pt.lat) polyline.push(pt);
          }
          segments.push({ instruction: seg.bus?.buslines?.[0]?.name ?? '步行', distance: 0, duration: 0, polyline: pts });
        }
        return { mode, origin, destination, distance: Number(t.distance ?? 0), duration: Number(t.duration ?? 0), segments, polyline };
      }

      const endpoint = mode === 'driving' ? 'driving' : mode === 'walking' ? 'walking' : 'bicycling';
      const url = new URL(`https://restapi.amap.com/v3/direction/${endpoint}`);
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
      url.searchParams.set('destination', `${destination.lng},${destination.lat}`);
      if (waypoints?.length && mode === 'driving') {
        url.searchParams.set('waypoints', waypoints.map((w) => `${w.lng},${w.lat}`).join(';'));
      }
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        route?: { paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ instruction?: string; distance?: string; duration?: string; polyline?: string }> }> };
      };
      ensureOk(json);
      const path = json.route?.paths?.[0];
      if (!path) throw new Error('AMap error: no route path');
      const segments: RouteSegment[] = (path.steps ?? []).map((s) => ({
        instruction: s.instruction ?? '',
        distance: Number(s.distance ?? 0),
        duration: Number(s.duration ?? 0),
        polyline: parsePolyline(s.polyline ?? ''),
      }));
      const polyline: LngLat[] = [];
      for (const s of segments) {
        for (const pt of s.polyline) {
          const last = polyline[polyline.length - 1];
          if (!last || last.lng !== pt.lng || last.lat !== pt.lat) polyline.push(pt);
        }
      }
      return {
        mode,
        origin,
        destination,
        distance: Number(path.distance ?? 0),
        duration: Number(path.duration ?? 0),
        segments,
        polyline,
      };
    },
  };
}
