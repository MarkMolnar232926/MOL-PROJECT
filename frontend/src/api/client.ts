import type { components } from "./schema";

type S = components["schemas"];
export type HealthResponse = S["HealthResponse"];
export type ConfigResponse = S["ConfigResponse"];
export type SessionState = S["SessionState"];
export type OriginalUploaded = S["OriginalUploaded"];
export type IncomingUploaded = S["IncomingUploaded"];
export type OriginalSummary = S["OriginalSummary"];
export type IncomingSummary = S["IncomingSummary"];
export type SheetInfo = S["SheetInfo"];
export type SessionResult = S["SessionResult"];
export type MatchSummary = S["MatchSummary"];
export type IncomingResult = S["IncomingResult"];
export type IncomingItem = S["IncomingItem"];
export type ExistingItem = S["ExistingItem"];
export type Candidate = S["Candidate"];
export type CriterionCheck = S["CriterionCheck"];
export type Criterion = S["Criterion"];
export type RowStatus = S["RowStatus"];
export type NoMatchReason = S["NoMatchReason"];
export type LogEntry = S["LogEntry"];
export type AssignmentRequest = S["AssignmentRequest"];
export type AssignmentResponse = S["AssignmentResponse"];
export type Note = S["Note"];
export type MessageParams = NonNullable<Note["params"]>;

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

async function send(path: string, init?: RequestInit): Promise<Response> {
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
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function upload(file: File, sheet?: string | null): RequestInit {
  const form = new FormData();
  form.append("file", file);
  if (sheet) form.append("sheet", sheet);
  return { method: "POST", body: form };
}

export type CandidateFilters = {
  includePaired: boolean;
  includeOtherTypes: boolean;
  includeDefective: boolean;
  q: string;
};

/** File name from a Content-Disposition header (RFC 5987 filename* preferred). */
export function dispositionFilename(disposition: string, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* malformed: use the plain name */
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  config: () => request<ConfigResponse>("/config"),
  createSession: () => request<SessionState>("/sessions", { method: "POST" }),
  state: (sid: string) => request<SessionState>(`/sessions/${sid}`),
  deleteSession: (sid: string) => request<void>(`/sessions/${sid}`, { method: "DELETE" }),
  uploadOriginal: (sid: string, file: File, sheet?: string | null) =>
    request<OriginalUploaded>(`/sessions/${sid}/original`, upload(file, sheet)),
  uploadIncoming: (sid: string, file: File, sheet?: string | null) =>
    request<IncomingUploaded>(`/sessions/${sid}/incoming`, upload(file, sheet)),
  match: (sid: string) => request<SessionResult>(`/sessions/${sid}/match`, { method: "POST" }),
  result: (sid: string) => request<SessionResult>(`/sessions/${sid}/result`),
  candidates: (sid: string, row: number, f: CandidateFilters) => {
    const params = new URLSearchParams();
    if (f.includePaired) params.set("include_paired", "true");
    if (f.includeOtherTypes) params.set("include_other_types", "true");
    if (f.includeDefective) params.set("include_defective", "true");
    if (f.q.trim()) params.set("q", f.q.trim());
    const qs = params.toString();
    return request<Candidate[]>(`/sessions/${sid}/incoming/${row}/candidates${qs ? `?${qs}` : ""}`);
  },
  assign: (sid: string, row: number, body: AssignmentRequest) =>
    request<AssignmentResponse>(`/sessions/${sid}/incoming/${row}/assignment`, json("PUT", body)),
  reset: (sid: string, row: number, confirmSwap = false) =>
    request<AssignmentResponse>(
      `/sessions/${sid}/incoming/${row}/assignment${confirmSwap ? "?confirm_swap=true" : ""}`,
      { method: "DELETE" },
    ),
  exportWorkbook: async (sid: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await send(`/sessions/${sid}/export`);
    const filename = dispositionFilename(
      res.headers.get("Content-Disposition") ?? "",
      "incoming_asset_id.xlsx",
    );
    return { blob: await res.blob(), filename };
  },
};
