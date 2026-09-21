// 页面级 3D 背景（three.js 流光层）的开关偏好
//
// 为什么存在：3D 层是持续渲染的 WebGL 画布，长期挂着会吃 GPU / 电量。
// 它不是站点数据（各区块背景仍由 site_settings.backgrounds 管理），只表达
// 「这台设备的这个浏览器要不要跑 3D 流光」，所以存 localStorage，不入库。
import { useEffect, useState } from "react";

const STORAGE_KEY = "pf-bg3d";

let cached: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();

function readStored(): boolean {
  try {
    // 只有显式存过 "0" 才算关闭；没存过（含隐私模式读失败）一律默认开启
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function getThreeBgEnabled(): boolean {
  if (cached === null) cached = readStored();
  return cached;
}

export function setThreeBgEnabled(value: boolean): void {
  cached = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // 隐私模式写不进去也无妨：本次会话内仍然生效
  }
  for (const listener of listeners) listener(value);
}

export function useThreeBgEnabled(): boolean {
  const [value, setValue] = useState(getThreeBgEnabled);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
