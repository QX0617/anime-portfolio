/**
 * 静态快照版数据客户端：把 PostgREST / Edge Functions 的请求全部转到本地 data.json。
 * 本文件不属于 Meoo 项目，不受平台自动生成约束。
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { staticFetch } from '../static/fetch';

export const supabaseUrl = "/sb-api";
export const supabaseAnonKey = 'static-snapshot-anon-key';

export function getSupabaseUrl(): string {
  return '/sb-api';
}

export const supabase = createClient<Database>(
  'https://static.local/sb-api',
  supabaseAnonKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: staticFetch as unknown as typeof fetch },
  }
);
