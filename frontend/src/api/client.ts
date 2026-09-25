import type { components } from "./schema";

type S = components["schemas"];
export type HealthResponse = S["HealthResponse"];
export type ConfigResponse = S["ConfigResponse"];
export type SessionCreated = S["SessionCreated"];
export type SessionResult = S["SessionResult"];
export type DetectedSheet = S["DetectedSheet"];
export type SapRow = S["SapRow"];
export type PhysicalRow = S["PhysicalRow"];
export type Discrepancy = S["Discrepancy"];
export type TieGroup = S["TieGroup"];
export type TieSlot = S["TieSlot"];
export type TieCandidate = S["TieCandidate"];
export type TieAssignment = S["TieAssignment"];
export type Summary = S["Summary"];
export type MatchStatus = SapRow["match_status"];
export type Confidence = NonNullable<SapRow["confidence"]>;

export type ErrorDetail = Record<string, unknown>;

/** A structured error from the API: {"error": {code, message, details}}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", "The server could not be reached.");
  }
  if (!res.ok) {
    let body: { error?: { code: string; message: string; details?: ErrorDetail[] } } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const e = body.error;
    throw new ApiError(
      res.status,
      e?.code ?? "http_error",
      e?.message ?? `${res.status} ${res.statusText}`,
      e?.details ?? [],
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export type UploadInput = { workbook: File } | { physical: File; sap: File };

export const api = {
  health: () => request<HealthResponse>("/health"),
  config: () => request<ConfigResponse>("/config"),
  createSession: (input: UploadInput) => {
    const form = new FormData();
    for (const [key, file] of Object.entries(input)) form.append(key, file as File);
    return request<SessionCreated>("/sessions", { method: "POST", body: form });
  },
  result: (sessionId: string) => request<SessionResult>(`/sessions/${sessionId}/result`),
  decideTie: (sessionId: string, groupId: string, assignments: TieAssignment[]) =>
    request<TieGroup>(
      `/sessions/${sessionId}/ties/${encodeURIComponent(groupId)}`,
      json("PUT", { assignments }),
    ),
  resetTie: (sessionId: string, groupId: string) =>
    request<TieGroup>(`/sessions/${sessionId}/ties/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    }),
  exportWorkbook: async (sessionId: string): Promise<{ blob: Blob; filename: string }> => {
    let res: Response;
    try {
      res = await fetch(`/api/sessions/${sessionId}/export`);
    } catch {
      throw new ApiError(0, "network_error", "The server could not be reached.");
    }
    if (!res.ok) throw new ApiError(res.status, "export_failed", `Export failed (${res.status}).`);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "reconciled.xlsx";
    return { blob: await res.blob(), filename };
  },
};
