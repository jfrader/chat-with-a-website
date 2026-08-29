import {
  createChatRequestSchema,
  createSessionRequestSchema,
  type SessionStreamEvent,
} from "@profound/contracts"
import { describe, expect, it, vi } from "vitest"
import { LlmError } from "./llm"
import { SessionService } from "./session-service"
import { FakeLlm, fetchedHtml, MemorySessionRepository } from "./session-test-support"

const request = createSessionRequestSchema.parse({
  url: "https://example.com/article",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
})

const page = { finalUrl: request.url, html: fetchedHtml }

const collect = async <T>(events: AsyncIterable<T>) => {
  const values: T[] = []
  for await (const event of events) values.push(event)
  return values
}

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

class BlockingDeleteRepository extends MemorySessionRepository {
  readonly deleteStarted = deferred<void>()
  readonly releaseDelete = deferred<void>()
  #shouldBlockDelete = true

  override async delete(id: string): Promise<boolean> {
    if (this.#shouldBlockDelete) {
      this.#shouldBlockDelete = false
      this.deleteStarted.resolve()
      await this.releaseDelete.promise
    }
    return super.delete(id)
  }
}

class BlockingCreateResultRepository extends MemorySessionRepository {
  readonly createdSessionId = deferred<string>()
  readonly releaseCreate = deferred<void>()
  #shouldBlockCreate = true

  override async createOrGet(input: Parameters<MemorySessionRepository["createOrGet"]>[0]) {
    const result = await super.createOrGet(input)
    if (this.#shouldBlockCreate) {
      this.#shouldBlockCreate = false
      this.createdSessionId.resolve(result.session.id)
      await this.releaseCreate.promise
    }
    return result
  }
}

class BlockingCreateMessagesRepository extends MemorySessionRepository {
  readonly createMessagesStarted = deferred<void>()
  readonly releaseCreateMessages = deferred<void>()
  #shouldBlockCreateMessages = true

  override async createMessages(sessionId: string, requestId: string, content: string) {
    if (this.#shouldBlockCreateMessages) {
      this.#shouldBlockCreateMessages = false
      this.createMessagesStarted.resolve()
      await this.releaseCreateMessages.promise
    }
    return super.createMessages(sessionId, requestId, content)
  }
}

class FailingInitialChatUpdateRepository extends MemorySessionRepository {
  updateMessageAttempts = 0

  override async updateMessage(
    id: string,
    update: Parameters<MemorySessionRepository["updateMessage"]>[1],
  ) {
    this.updateMessageAttempts += 1
    if (this.updateMessageAttempts === 1) throw new Error("provider persistence failed")
    return super.updateMessage(id, update)
  }
}

class FailingSessionFailurePersistenceRepository extends MemorySessionRepository {
  override async update(id: string, update: Parameters<MemorySessionRepository["update"]>[1]) {
    if (update.status === "failed") throw new Error("session failure persistence failed")
    return super.update(id, update)
  }
}

class FailingChatFailurePersistenceRepository extends MemorySessionRepository {
  override async updateMessage(
    id: string,
    update: Parameters<MemorySessionRepository["updateMessage"]>[1],
  ) {
    if (update.status === "failed") throw new Error("chat failure persistence failed")
    return super.updateMessage(id, update)
  }
}

class StaleSessionReadRepository extends MemorySessionRepository {
  readonly readCaptured = deferred<void>()
  readonly releaseRead = deferred<void>()
  #armed = false
  #captured = false

  arm(): void {
    this.#armed = true
  }

  override async findById(id: string) {
    const snapshot = await super.findById(id)
    if (this.#armed && !this.#captured) {
      this.#captured = true
      this.readCaptured.resolve()
      await this.releaseRead.promise
    }
    return snapshot
  }
}

describe("SessionService", () => {
  it("publishes real LLM deltas with offsets and persists the completed summary", async () => {
    const repository = new MemorySessionRepository()
    let releaseFetch!: (value: typeof page) => void
    const service = new SessionService({
      repository,
      llm: new FakeLlm(["First ", "second."]),
      partialWriteIntervalMs: 0,
      fetchPage: () => new Promise((resolve) => (releaseFetch = resolve)),
    })
    const created = await service.create(request)
    const stream = await service.stream(created.session.id)
    if (!stream) throw new Error("Expected stream")
    const eventsPromise = collect(stream.events)
    releaseFetch(page)
    await service.waitForAll()
    const events = await eventsPromise

    const deltas = events.filter(
      (event): event is Extract<SessionStreamEvent, { type: "summary.delta" }> =>
        event.type === "summary.delta",
    )
    expect(deltas.map(({ delta }) => delta)).toEqual(["First ", "second."])
    expect(deltas.map(({ offset }) => offset)).toEqual([0, 6])
    expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(events.length)
    expect(events.at(-1)?.type).toBe("summary.completed")
    expect(await service.get(created.session.id)).toMatchObject({
      status: "complete",
      summary: "First second.",
      provider: "fake",
      model: "fake-model",
      generationVersion: 1,
    })
    expect(repository.records.get(created.session.id)?.sourceText).toContain("source opens")
  })

  it("persists a typed failure and partial text when the LLM fails mid-stream", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(["Partial", new LlmError("LLM_RATE_LIMITED")]),
      fetchPage: async () => page,
    })
    const created = await service.create(request)
    await service.waitForAll()

    expect(await service.get(created.session.id)).toMatchObject({
      status: "failed",
      summary: "Partial",
      failureStage: "summarizing",
      failureCode: "LLM_RATE_LIMITED",
    })
    const stream = await service.stream(created.session.id)
    expect(stream && (await collect(stream.events)).at(-1)?.type).toBe("summary.failed")
  })

  it("closes the summary stream when a pipeline failure cannot be persisted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const repository = new FailingSessionFailurePersistenceRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm([new LlmError("LLM_RATE_LIMITED")]),
      fetchPage: async () => page,
    })
    const created = await service.create(request)
    const stream = await service.stream(created.session.id)
    if (!stream) throw new Error("Expected stream")
    const eventsPromise = collect(stream.events)

    await service.waitForAll()
    const events = await eventsPromise

    expect(
      events.some(({ type }) => type === "summary.completed" || type === "summary.failed"),
    ).toBe(false)
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it("rejects idempotency-key reuse for a different URL", async () => {
    const service = new SessionService({
      repository: new MemorySessionRepository(),
      llm: new FakeLlm(),
      fetchPage: async () => page,
    })
    await service.create(request)
    await expect(
      service.create({ ...request, url: "https://example.org/other" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    await service.waitForAll()
  })

  it("admits concurrent new sessions atomically and removes the rejected row", async () => {
    const repository = new MemorySessionRepository()
    let releaseFetch!: () => void
    const fetchGate = new Promise<void>((resolve) => (releaseFetch = resolve))
    const service = new SessionService({
      repository,
      llm: new FakeLlm(),
      maxConcurrentGenerations: 1,
      fetchPage: async () => {
        await fetchGate
        return page
      },
    })
    const otherRequest = createSessionRequestSchema.parse({
      url: "https://example.net/other",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    })

    const outcomes = await Promise.allSettled([
      service.create(request),
      service.create(otherRequest),
    ])
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "RATE_LIMITED" },
    })
    expect(repository.records.size).toBe(1)

    releaseFetch()
    await service.waitForAll()
  })

  it("lets an idempotent replay bypass admission while rejecting unrelated work", async () => {
    const repository = new MemorySessionRepository()
    let releaseFetch!: () => void
    let markFetchStarted!: () => void
    const fetchGate = new Promise<void>((resolve) => (releaseFetch = resolve))
    const fetchStarted = new Promise<void>((resolve) => (markFetchStarted = resolve))
    const service = new SessionService({
      repository,
      llm: new FakeLlm(),
      maxConcurrentGenerations: 1,
      fetchPage: async () => {
        markFetchStarted()
        await fetchGate
        return page
      },
    })
    const created = await service.create(request)
    await fetchStarted

    const replay = await service.create(request)
    expect(replay).toMatchObject({ created: false, session: { id: created.session.id } })
    await expect(
      service.create({
        url: "https://example.net/rejected",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(repository.records.size).toBe(1)

    releaseFetch()
    await service.waitForAll()
  })

  it("does not expose an unadmitted session to a concurrent idempotent replay", async () => {
    const repository = new BlockingDeleteRepository()
    const fetchStarted = deferred<void>()
    const releaseFetch = deferred<void>()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(),
      maxConcurrentGenerations: 1,
      fetchPage: async () => {
        fetchStarted.resolve()
        await releaseFetch.promise
        return page
      },
    })
    await service.create(request)
    await fetchStarted.promise
    const rejectedRequest = createSessionRequestSchema.parse({
      url: "https://example.net/rejected",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    })

    const firstAttempt = service.create(rejectedRequest)
    await repository.deleteStarted.promise
    const replay = service.create(rejectedRequest)
    let replaySettled = false
    void replay.then(
      () => {
        replaySettled = true
      },
      () => {
        replaySettled = true
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(replaySettled).toBe(false)

    repository.releaseDelete.resolve()
    await expect(firstAttempt).rejects.toMatchObject({ code: "RATE_LIMITED" })
    await expect(replay).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(repository.records.size).toBe(1)

    releaseFetch.resolve()
    await service.waitForAll()
  })

  it("does not start work for a new session deleted before admission completes", async () => {
    const repository = new BlockingCreateResultRepository()
    const fetchPage = vi.fn(async () => page)
    const service = new SessionService({ repository, llm: new FakeLlm(), fetchPage })

    const creation = service.create(request)
    const sessionId = await repository.createdSessionId.promise
    expect(await service.delete(sessionId)).toBe(true)
    repository.releaseCreate.resolve()

    await expect(creation).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    expect(fetchPage).not.toHaveBeenCalled()
    expect(await service.get(sessionId)).toBeNull()
  })

  it("rejects admission that resumes after shutdown and removes its unstarted row", async () => {
    const repository = new BlockingCreateResultRepository()
    const fetchPage = vi.fn(async () => page)
    const service = new SessionService({ repository, llm: new FakeLlm(), fetchPage })

    const creation = service.create(request)
    const sessionId = await repository.createdSessionId.promise
    service.shutdown()
    repository.releaseCreate.resolve()

    await expect(creation).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    await expect(service.create(request)).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" })
    expect(fetchPage).not.toHaveBeenCalled()
    expect(await service.get(sessionId)).toBeNull()
  })

  it("lists newest sessions, searches persisted fields, and deletes with cascade", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(),
      fetchPage: async () => page,
    })
    const first = await repository.createOrGet(request)
    await repository.update(first.session.id, { title: "Needle title", status: "complete" })
    const second = await repository.createOrGet({
      url: "https://example.net/newer",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    })
    await repository.update(second.session.id, { status: "complete", summary: "Other summary" })
    await repository.createMessages(first.session.id, "55555555-5555-4555-8555-555555555555", "Hi")

    expect((await service.list({ query: "", limit: 1 })).sessions[0]?.id).toBe(second.session.id)
    expect(
      (await service.list({ query: "needle", limit: 20 })).sessions.map(({ id }) => id),
    ).toEqual([first.session.id])
    expect(await service.delete(first.session.id)).toBe(true)
    expect(await service.get(first.session.id)).toBeNull()
    expect(await repository.listMessages(first.session.id)).toEqual([])
  })

  it("persists isolated session chat and replays idempotent completion", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm(["Answer ", "one."])
    const service = new SessionService({ repository, llm, fetchPage: async () => page })
    const first = await repository.createOrGet(request)
    const second = await repository.createOrGet({
      url: "https://example.net/second",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    })
    await repository.update(first.session.id, {
      status: "complete",
      sourceText: "First source",
      summary: "First summary",
    })
    await repository.update(second.session.id, {
      status: "complete",
      sourceText: "Second source",
      summary: "Second summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "What happened?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })
    const firstChat = await service.chat(first.session.id, chatRequest)
    if (!firstChat) throw new Error("Expected chat")
    await collect(firstChat.events)
    await service.waitForAll()
    const replay = await service.chat(first.session.id, chatRequest)
    if (!replay) throw new Error("Expected replay")
    expect((await collect(replay.events)).map(({ type }) => type)).toEqual(["chat.completed"])
    expect(
      (await service.messages(first.session.id))?.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "What happened?" },
      { role: "assistant", content: "Answer one." },
    ])
    expect(await service.messages(second.session.id)).toEqual([])
    expect(llm.requests).toHaveLength(1)
  })

  it("stores a model-written tagline and follow-up prompts on the completed session", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm(
      ["A summary about gardening puzzles."],
      [
        '{"tagline": "Daily garden logic puzzle game", "questions": ["How do daily puzzles rotate?", "What crops appear?", "Is there a streak system?"]}',
      ],
    )
    const service = new SessionService({ repository, llm, fetchPage: async () => page })
    const { session } = await service.create(request)
    await service.waitForAll()

    const completed = await service.get(session.id)
    expect(completed?.status).toBe("complete")
    expect(completed?.tagline).toBe("Daily garden logic puzzle game")
    expect(completed?.suggestedPrompts).toEqual([
      "How do daily puzzles rotate?",
      "What crops appear?",
      "Is there a streak system?",
    ])
  })

  it("completes without suggestions when the follow-up generation fails", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm(["A useful summary."], [new Error("suggestions down")])
    const service = new SessionService({ repository, llm, fetchPage: async () => page })
    const { session } = await service.create(request)
    await service.waitForAll()

    const completed = await service.get(session.id)
    expect(completed?.status).toBe("complete")
    expect(completed?.suggestedPrompts).toEqual([])
    expect(completed?.tagline).toBeNull()
  })

  it("loads a linked page from the chat message into the model context", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm(["The registration page asks for an email."])
    const fetchPage = vi.fn(async (url: string) => ({
      ...page,
      finalUrl: url,
      html: "<html><head><title>Registro</title></head><body><main>Create your club with an email and a club name to join the alpha league today.</main></body></html>",
    }))
    const service = new SessionService({ repository, llm, fetchPage })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Landing source",
      summary: "Landing summary",
    })
    const chat = await service.chat(created.session.id, {
      content: "What does /register ask for?",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    })
    if (!chat) throw new Error("Expected chat")
    await collect(chat.events)
    await service.waitForAll()

    expect(fetchPage).toHaveBeenCalledWith(
      `${new URL("/register", created.session.canonicalUrl)}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    const llmMessages = llm.requests[0]?.messages ?? []
    const loaded = llmMessages.find((message) => message.content.startsWith("Loaded page"))
    expect(loaded?.content).toContain("Registro")
    expect(loaded?.content).toContain("Create your club with an email")
  })

  it("streams reasoning deltas separately and persists them with the completed answer", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm([
      { reasoning: "Consider the " },
      { reasoning: "source first." },
      "Answer ",
      "two.",
    ])
    const service = new SessionService({ repository, llm, fetchPage: async () => page })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Chat source",
      summary: "Chat summary",
    })
    const chat = await service.chat(created.session.id, {
      content: "Why?",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    })
    if (!chat) throw new Error("Expected chat")
    const events = await collect(chat.events)
    await service.waitForAll()
    const reasoningEvents = events.filter((event) => event.type === "chat.reasoning")
    expect(reasoningEvents.map((event) => event.delta).join("")).toBe("Consider the source first.")
    const assistant = (await service.messages(created.session.id))?.find(
      (message) => message.role === "assistant",
    )
    expect(assistant?.content).toBe("Answer two.")
    expect(assistant?.reasoningContent).toBe("Consider the source first.")
    expect(assistant?.reasoningMs).toBeGreaterThanOrEqual(0)
  })

  it("serializes chat admission with deletion and clears the admitted chat", async () => {
    const repository = new BlockingCreateMessagesRepository()
    const abortSeen = deferred<void>()
    const releaseLlm = deferred<void>()
    let observedAbort = false
    const llm = new FakeLlm(async function* ({ signal }) {
      if (signal.aborted) {
        observedAbort = true
        abortSeen.resolve()
        throw new LlmError("GENERATION_INTERRUPTED")
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true
              abortSeen.resolve()
              resolve()
            },
            { once: true },
          )
        }),
        releaseLlm.promise,
      ])
      if (signal.aborted) throw new LlmError("GENERATION_INTERRUPTED")
      yield "Late answer"
    })
    const service = new SessionService({ repository, llm })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "Question?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })

    const chatPromise = service.chat(created.session.id, chatRequest)
    await repository.createMessagesStarted.promise
    const deletePromise = service.delete(created.session.id)
    let deletionSettled = false
    void deletePromise.then(() => {
      deletionSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deletionSettled).toBe(false)

    repository.releaseCreateMessages.resolve()
    const stream = await chatPromise
    if (!stream) throw new Error("Expected chat stream")
    expect(await deletePromise).toBe(true)
    await abortSeen.promise
    expect(observedAbort).toBe(true)
    expect(await repository.listMessages(created.session.id)).toEqual([])
    expect(await service.get(created.session.id)).toBeNull()
    expect(await collect(stream.events)).toEqual([])

    releaseLlm.resolve()
    await service.waitForAll()
  })

  it("persists a terminal chat failure when the provider update throws", async () => {
    const repository = new FailingInitialChatUpdateRepository()
    const service = new SessionService({ repository, llm: new FakeLlm() })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "Question?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })

    const stream = await service.chat(created.session.id, chatRequest)
    if (!stream) throw new Error("Expected chat stream")
    await service.waitForAll()

    expect(repository.updateMessageAttempts).toBe(2)
    expect((await repository.listMessages(created.session.id)).at(-1)).toMatchObject({
      role: "assistant",
      status: "failed",
      failureCode: "INTERNAL_ERROR",
    })
    expect((await collect(stream.events)).map(({ type }) => type)).toEqual([
      "chat.created",
      "chat.failed",
    ])
  })

  it("closes the chat stream when a generation failure cannot be persisted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const repository = new FailingChatFailurePersistenceRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm([new LlmError("LLM_RATE_LIMITED")]),
    })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "Question?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })

    const stream = await service.chat(created.session.id, chatRequest)
    if (!stream) throw new Error("Expected chat stream")
    const eventsPromise = collect(stream.events)

    await service.waitForAll()

    expect((await eventsPromise).map(({ type }) => type)).toEqual(["chat.created"])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it("includes only complete request pairs in chat history", async () => {
    const repository = new MemorySessionRepository()
    const llm = new FakeLlm(["New answer"])
    const service = new SessionService({ repository, llm })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const complete = await repository.createMessages(
      created.session.id,
      "55555555-5555-4555-8555-555555555555",
      "Complete question",
    )
    await repository.updateMessage(complete.assistantMessage.id, {
      content: "Complete answer",
      status: "complete",
      completedAt: new Date(),
    })
    const failed = await repository.createMessages(
      created.session.id,
      "66666666-6666-4666-8666-666666666666",
      "Failed question",
    )
    await repository.updateMessage(failed.assistantMessage.id, {
      content: "Failed partial",
      status: "failed",
      failureCode: "INTERNAL_ERROR",
      completedAt: new Date(),
    })
    const inFlight = await repository.createMessages(
      created.session.id,
      "77777777-7777-4777-8777-777777777777",
      "In-flight question",
    )
    await repository.updateMessage(inFlight.assistantMessage.id, { content: "In-flight partial" })
    const unmatched = await repository.createMessages(
      created.session.id,
      "88888888-8888-4888-8888-888888888888",
      "Unmatched question",
    )
    repository.messagesById.delete(unmatched.assistantMessage.id)

    const stream = await service.chat(
      created.session.id,
      createChatRequestSchema.parse({
        content: "Current question",
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
      }),
    )
    if (!stream) throw new Error("Expected chat stream")
    await collect(stream.events)
    await service.waitForAll()

    expect(llm.requests).toHaveLength(1)
    expect(llm.requests[0]?.messages.slice(3)).toEqual([
      { role: "user", content: "Complete question" },
      { role: "assistant", content: "Complete answer" },
      { role: "user", content: "Current question" },
    ])
  })

  it("delivers immediate chat deltas emitted before stream iteration in one contiguous update", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(["A", "B"]),
      partialWriteIntervalMs: 0,
    })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "Question?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })

    const stream = await service.chat(created.session.id, chatRequest)
    if (!stream) throw new Error("Expected chat stream")
    await service.waitForAll()
    const events = await collect(stream.events)

    expect(events.map(({ type }) => type)).toEqual(["chat.created", "chat.delta", "chat.completed"])
    expect(events[1]).toMatchObject({ type: "chat.delta", offset: 0, delta: "AB" })
    expect(events[2]).toMatchObject({ type: "chat.completed", message: { content: "AB" } })
  })

  it("replays active chat state without starting a second generation", async () => {
    const repository = new MemorySessionRepository()
    let release!: () => void
    let markFirstProcessed!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const firstProcessed = new Promise<void>((resolve) => (markFirstProcessed = resolve))
    const llm = new FakeLlm(async function* () {
      yield "A"
      markFirstProcessed()
      await gate
      yield "B"
    })
    const service = new SessionService({ repository, llm, partialWriteIntervalMs: 0 })
    const created = await repository.createOrGet(request)
    await repository.update(created.session.id, {
      status: "complete",
      sourceText: "Source",
      summary: "Summary",
    })
    const chatRequest = createChatRequestSchema.parse({
      content: "Question?",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })
    const first = await service.chat(created.session.id, chatRequest)
    if (!first) throw new Error("Expected first chat stream")
    await firstProcessed

    const replay = await service.chat(created.session.id, chatRequest)
    if (!replay) throw new Error("Expected replay chat stream")
    const iterator = replay.events[Symbol.asyncIterator]()
    expect((await iterator.next()).value?.type).toBe("chat.created")
    expect((await iterator.next()).value).toMatchObject({ type: "chat.delta", delta: "A" })

    release()
    const remaining = []
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
      remaining.push(next.value)
    }
    expect(remaining).toMatchObject([
      { type: "chat.delta", offset: 1, delta: "B" },
      { type: "chat.completed", message: { content: "AB" } },
    ])
    expect(llm.requests).toHaveLength(1)
    first.close()
    await service.waitForAll()
  })

  it("marks stale sessions and messages interrupted during initialization", async () => {
    const repository = new MemorySessionRepository()
    const created = await repository.createOrGet(request)
    const pair = await repository.createMessages(
      created.session.id,
      "55555555-5555-4555-8555-555555555555",
      "Question",
    )
    const service = new SessionService({ repository, llm: new FakeLlm() })
    await service.initialize()
    expect(await service.get(created.session.id)).toMatchObject({
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
    })
    expect(repository.messagesById.get(pair.assistantMessage.id)).toMatchObject({
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
    })
  })

  it("aborts local generation before deleting persistence", async () => {
    const repository = new MemorySessionRepository()
    let entered!: () => void
    const started = new Promise<void>((resolve) => (entered = resolve))
    let observedAbort = false
    const llm = new FakeLlm(async function* ({ signal }) {
      entered()
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
      observedAbort = signal.aborted
      throw new LlmError("GENERATION_INTERRUPTED")
    })
    const service = new SessionService({ repository, llm, fetchPage: async () => page })
    const created = await service.create(request)
    await started
    expect(await service.delete(created.session.id)).toBe(true)
    await service.waitForAll()
    expect(observedAbort).toBe(true)
    expect(await service.get(created.session.id)).toBeNull()
  })

  it("returns one persisted terminal event after a completion raced stream setup", async () => {
    const repository = new MemorySessionRepository()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(["Done"]),
      fetchPage: async () => page,
    })
    const created = await service.create(request)
    await service.waitForAll()
    const stream = await service.stream(created.session.id)
    if (!stream) throw new Error("Expected stream")
    const events = await collect(stream.events)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("summary.completed")
    expect(events[0]?.session.summary).toBe("Done")
  })

  it("returns the final terminal event when completion races a stale initial read", async () => {
    const repository = new StaleSessionReadRepository()
    const generationStarted = deferred<void>()
    const releaseGeneration = deferred<void>()
    const service = new SessionService({
      repository,
      llm: new FakeLlm(async function* () {
        generationStarted.resolve()
        await releaseGeneration.promise
        yield "Done"
      }),
      fetchPage: async () => page,
    })
    const created = await service.create(request)
    await generationStarted.promise
    repository.arm()

    const streamPromise = service.stream(created.session.id)
    await repository.readCaptured.promise
    releaseGeneration.resolve()
    await service.waitForAll()
    repository.releaseRead.resolve()

    const stream = await streamPromise
    if (!stream) throw new Error("Expected stream")
    const events = await collect(stream.events)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "summary.completed",
      session: { status: "complete", summary: "Done" },
    })
  })
})
