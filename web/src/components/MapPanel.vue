<template>
  <div class="map-panel"><div ref="el" class="map"></div></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { loadAmap } from '../composables/useAmap';
import { useMapStore } from '../stores/map';

const key = import.meta.env.VITE_AMAP_JS_KEY as string;
const security = import.meta.env.VITE_AMAP_SECURITY as string | undefined;
const el = ref<HTMLDivElement>();
const store = useMapStore();
let AMap: any, map: any;
let markers: any[] = [];
let polylines: any[] = [];
const ROUTE_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1'];

onMounted(async () => {
  AMap = await loadAmap(key, security);
  map = new AMap.Map(el.value, { zoom: 11, center: [116.397, 39.9] });
  store.setMap(map);
});

watch(
  () => store.pois,
  (pois) => {
    markers.forEach((m) => m.setMap(null));
    markers = pois.map((p) => {
      const m = new AMap.Marker({ position: [p.location.lng, p.location.lat], title: p.name });
      m.setMap(map);
      return m;
    });
    if (pois.length && map) map.setFitView();
  },
  { deep: true },
);

watch(
  () => store.routes,
  (routes) => {
    polylines.forEach((p) => p.setMap(null));
    polylines = routes.map((r, i) => {
      const pl = new AMap.Polyline({
        path: r.polyline.map((pt) => [pt.lng, pt.lat]),
        strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length],
        strokeWeight: 5,
        strokeOpacity: 0.9,
      });
      pl.setMap(map);
      return pl;
    });
    if (routes.length && map) map.setFitView();
  },
  { deep: true },
);
</script>

<style scoped>
.map-panel { height: 100%; }
.map { width: 100%; height: 100%; }
</style>
