import { defineConfig, type Plugin } from 'vitest/config';

// vite-node 2.1.9 的 normalizeModuleId 只把 'node:test' 列入 prefixedBuiltins，
// 会把静态 import 'node:sqlite' 的前缀去掉，按裸模块 'sqlite' 请求服务端，
// 进而报 "Failed to load url sqlite"。这里提供一个虚拟 shim：拦截 'sqlite'
// 与 'node:sqlite'，返回用 createRequire 动态加载真实 node:sqlite 的代码，
// 避开 vite-node 对静态 import 的前缀剥离。
function nodeSqliteShim(): Plugin {
  const SHIM_ID = '\0node:sqlite:shim';
  return {
    name: 'node-sqlite-shim',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'node:sqlite' || id === 'sqlite') return SHIM_ID;
      return null;
    },
    load(id) {
      if (id !== SHIM_ID) return null;
      return [
        "import { createRequire } from 'node:module';",
        'const _mod = createRequire(import.meta.url)("node:sqlite");',
        'export const DatabaseSync = _mod.DatabaseSync;',
        'export default _mod;',
      ].join('\n');
    },
  };
}

export default defineConfig({
  plugins: [nodeSqliteShim()],
  test: { environment: 'node', globals: true },
});
