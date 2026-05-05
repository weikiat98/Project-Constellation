// Client-side error classifier — mirrors backend/orchestrator/errors.py so
// that fetch failures (uploads, deletes, etc.) get the same layman + technical
// pairing the SSE error path uses.
//
// The backend `request()` helper throws Error(`API ${status}: ${body}`), so we
// parse the status out of the message when present. Network-level failures
// (TypeError from fetch) get a dedicated "connection_error" branch.

export interface ClientErrorPayload {
  code: string;
  status: number | null;
  technical: string;
  layman: string;
}

const LAYMAN_BY_STATUS: Record<number, { code: string; layman: string }> = {
  400: {
    code: "invalid_request",
    layman: "Something about the request was malformed. Please try again, or refresh the page.",
  },
  401: {
    code: "auth_failed",
    layman: "Your session has expired or the credentials were rejected. Please refresh the page.",
  },
  403: {
    code: "permission_denied",
    layman: "You don't have permission to perform this action.",
  },
  404: {
    code: "not_found",
    layman: "The item you asked for couldn't be found. It may have been deleted.",
  },
  408: {
    code: "timeout",
    layman: "The server took too long to respond. Please try again.",
  },
  409: {
    code: "conflict",
    layman: "This action conflicts with the current state. Refresh the page and try again.",
  },
  413: {
    code: "payload_too_large",
    layman: "The file or message is too large. Try a smaller file.",
  },
  429: {
    code: "rate_limit",
    layman:
      "We're sending requests faster than the service allows. Please wait a moment and try again.",
  },
  500: {
    code: "server_error",
    layman: "The server had an unexpected problem. This isn't your fault — please try again.",
  },
  502: { code: "bad_gateway", layman: "We couldn't reach the server. Please try again shortly." },
  503: {
    code: "service_unavailable",
    layman: "The service is temporarily unavailable. Please try again in a moment.",
  },
  504: { code: "gateway_timeout", layman: "The server didn't respond in time. Please try again." },
  529: {
    code: "overloaded",
    layman:
      "The AI service is at capacity right now. This isn't your usage limit — please try again in a minute.",
  },
};

const CONTEXT_LAYMAN: Record<string, string> = {
  upload: "We couldn't upload that file. ",
  delete: "We couldn't delete that item. ",
  generic: "",
};

export function classifyClientError(
  err: unknown,
  context: keyof typeof CONTEXT_LAYMAN = "generic"
): ClientErrorPayload {
  const prefix = CONTEXT_LAYMAN[context] ?? "";

  if (err instanceof TypeError) {
    return {
      code: "connection_error",
      status: null,
      technical: `TypeError (network): ${err.message}`,
      layman:
        prefix +
        "We couldn't reach the server — check your internet connection and try again.",
    };
  }

  const message = err instanceof Error ? err.message : String(err);

  // Match the shape thrown by lib/api.ts: `API ${status}: ${body}`
  const apiMatch = /^API (\d{3}):\s*([\s\S]*)$/.exec(message);
  if (apiMatch) {
    const status = Number(apiMatch[1]);
    const body = apiMatch[2] || "";
    const mapping = LAYMAN_BY_STATUS[status] ?? {
      code: "api_error",
      layman: "The server returned an unexpected error. Please try again.",
    };
    return {
      code: mapping.code,
      status,
      technical: `HTTP ${status}: ${body || "(empty body)"}`,
      layman: prefix + mapping.layman,
    };
  }

  return {
    code: "internal_error",
    status: null,
    technical: message,
    layman: prefix + "Something unexpected went wrong. Please try again.",
  };
}
