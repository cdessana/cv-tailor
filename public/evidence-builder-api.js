export class EvidenceBuilderApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new EvidenceBuilderApiError(payload.error || "Evidence Builder request failed.", { code: payload.code, status: response.status, details: payload.details });
  return payload;
}

export const evidenceBuilderApi = Object.freeze({
  status: () => request("/api/evidence/builder"),
  build: (payload) => request("/api/evidence/builder", { method: "POST", body: payload }),
  answerQuestionnaire: (payload) => request("/api/evidence/builder/questionnaire", { method: "POST", body: payload }),
  review: (payload) => request("/api/evidence/builder/review", { method: "POST", body: payload }),
  promote: (payload) => request("/api/evidence/builder/promote", { method: "POST", body: payload }),
});
