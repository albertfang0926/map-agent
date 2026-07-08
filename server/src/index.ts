import { serve } from '@hono/node-server';
import { createApp } from './api/server';
import { config } from './config';

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`f-agent server on http://localhost:${info.port}`);
});
