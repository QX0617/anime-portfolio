import { staticFetch } from "./fetch";

/**
 * 静态快照：把指向 Meoo 云的请求（supabase-js 与业务代码里的裸 fetch）全部转到本地 data.json。
 * 必须在其它模块之前导入，否则 createClient 会抓走原始 fetch。
 */
const CLOUD_PATH = /\/(sb-api|functions|rest|storage)\/|(?:^|\/)storage\/v1\//;

declare global {
  interface Window {
    __meooStaticPatched?: boolean;
  }
}

if (!window.__meooStaticPatched) {
  window.__meooStaticPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    return CLOUD_PATH.test(url) ? staticFetch(input, init) : original(input, init);
  }) as typeof fetch;
}

export {};
