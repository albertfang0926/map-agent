let loader: Promise<any> | null = null;

export function loadAmap(key: string, security?: string): Promise<any> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (security) {
      (window as any)._AMapSecurityConfig = { securityJsCode: security };
    }
    const cb = `_amap_init_${Date.now()}`;
    (window as any)[cb] = () => resolve((window as any).AMap);
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&callback=${cb}`;
    s.onerror = () => reject(new Error('AMap SDK 加载失败'));
    document.head.appendChild(s);
  });
  return loader;
}
