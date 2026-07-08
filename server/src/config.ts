import 'dotenv/config'; // 自动加载同目录 .env（谁 import config 就生效）

export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  amapApiKey: process.env.AMAP_API_KEY ?? '',
  port: Number(process.env.PORT ?? 3000),
};
