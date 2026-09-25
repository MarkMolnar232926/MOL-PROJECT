import type { components } from "./schema";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type ConfigResponse = components["schemas"]["ConfigResponse"];

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<HealthResponse>("/health"),
  config: () => getJson<ConfigResponse>("/config"),
};
