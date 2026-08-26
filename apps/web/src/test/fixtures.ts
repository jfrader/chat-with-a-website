import type { MessageDto, SessionDto } from "@profound/contracts"

export const sessionId = "0f4d59b6-8a0f-40cf-a680-fbd4aaf4600a"
export const secondSessionId = "a34f1146-bda1-4c6f-9c93-8a33c96c813f"
export const requestId = "23af0580-bfd4-4310-98f8-b9fcb9bc6718"
export const assistantMessageId = "d6dcecea-84fc-40e2-a1fe-526693753229"

export function createSession(overrides: Partial<SessionDto> = {}): SessionDto {
  return {
    id: sessionId,
    originalUrl: "https://tryprofound.com/article",
    canonicalUrl: "https://tryprofound.com/article",
    finalUrl: "https://tryprofound.com/article",
    host: "tryprofound.com",
    title: "A field guide to AI visibility",
    siteName: "Profound",
    description: "A practical guide to understanding visibility in AI answers.",
    summary: "## Main idea\n\nVisibility depends on useful, well-supported answers.",
    status: "complete",
    failureStage: null,
    failureCode: null,
    sourceWordCount: 640,
    sourceTruncated: false,
    provider: "openai",
    model: "gpt-test",
    attemptId: "76fc56a7-b60d-470c-8d10-ff84f2508947",
    attemptNumber: 1,
    generationVersion: 1,
    inputTokens: 820,
    outputTokens: 120,
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:02.000Z",
    completedAt: "2026-08-26T12:00:02.000Z",
    ...overrides,
  }
}

export function createMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "78692960-1462-4075-a934-c8376fd85c3f",
    sessionId,
    requestId,
    role: "user",
    content: "What matters most?",
    status: "complete",
    failureCode: null,
    provider: null,
    model: null,
    attemptId: null,
    attemptNumber: 1,
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-08-26T12:01:00.000Z",
    updatedAt: "2026-08-26T12:01:00.000Z",
    completedAt: "2026-08-26T12:01:00.000Z",
    ...overrides,
  }
}
