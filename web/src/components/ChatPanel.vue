<template>
  <div class="chat-panel">
    <div class="messages">
      <div v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]">
        <strong v-if="m.role === 'user'">你</strong>
        <strong v-else-if="m.role === 'assistant'">助手</strong>
        <strong v-else>🔧 {{ m.toolName }}</strong>
        <p>{{ m.content }}</p>
      </div>
    </div>
    <form class="input" @submit.prevent="onSend">
      <input v-model="text" placeholder="例如：找三里屯的咖啡馆" />
      <button :disabled="chat.loading || !text.trim()">发送</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();
const text = ref('');

async function onSend() {
  const t = text.value.trim();
  if (!t) return;
  text.value = '';
  await chat.send(t);
}
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.messages { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin-bottom: 10px; }
.msg.tool { color: #888; font-size: 0.9em; }
.input { display: flex; padding: 8px; border-top: 1px solid #ddd; gap: 8px; }
.input input { flex: 1; }
</style>
