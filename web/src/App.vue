<template>
  <div class="layout">
    <ChatPanel class="chat-col" />
    <MapPanel class="map-col" />
  </div>
</template>

<script setup lang="ts">
import ChatPanel from './components/ChatPanel.vue';
import MapPanel from './components/MapPanel.vue';
</script>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: flex; height: 100%; }
.chat-col { width: 40%; border-right: 1px solid #ddd; }
.map-col { width: 60%; }
</style>
