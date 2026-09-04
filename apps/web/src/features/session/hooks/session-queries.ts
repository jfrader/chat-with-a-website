import type { ListSessionsResponse, MessageDto, SessionDto } from "@chat-with-a-website/contracts"
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useRef } from "react"
import { useSessionApi } from "./use-session-api"

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (query: string) => [...sessionKeys.lists(), { query }] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
  messages: (id: string) => [...sessionKeys.detail(id), "messages"] as const,
}

export type SessionPages = InfiniteData<ListSessionsResponse, string | null>

function updateSessionInLists(
  response: ListSessionsResponse | undefined,
  session: SessionDto,
  insertIfMissing = true,
): ListSessionsResponse | undefined {
  if (!response) return response
  const existing = response.sessions.some((item) => item.id === session.id)
  const sessions = existing
    ? response.sessions.map((item) => (item.id === session.id ? session : item))
    : insertIfMissing
      ? [session, ...response.sessions]
      : response.sessions
  return { ...response, sessions }
}

function updateSessionInPages(
  data: SessionPages | undefined,
  session: SessionDto,
  insertIfMissing = false,
): SessionPages | undefined {
  if (!data) return data
  const existing = data.pages.some((page) => page.sessions.some((item) => item.id === session.id))
  const pages = data.pages.map((page) => updateSessionInLists(page, session, false) ?? page)
  if (!existing && insertIfMissing && pages[0]) {
    pages[0] = updateSessionInLists(pages[0], session) ?? pages[0]
  }
  return { ...data, pages }
}

export function useSessions(query: string) {
  const api = useSessionApi()
  return useInfiniteQuery({
    queryKey: sessionKeys.list(query),
    queryFn: ({ pageParam }) => (pageParam ? api.list(query, pageParam) : api.list(query)),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    select: (data) => ({
      ...data,
      sessions: data.pages.flatMap((page) => page.sessions),
    }),
  })
}

export function useSession(sessionId: string | undefined) {
  const api = useSessionApi()
  return useQuery({
    queryKey: sessionKeys.detail(sessionId ?? ""),
    queryFn: () => api.get(sessionId ?? ""),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  })
}

export function useMessages(sessionId: string | undefined, enabled: boolean) {
  const api = useSessionApi()
  return useQuery({
    queryKey: sessionKeys.messages(sessionId ?? ""),
    queryFn: () => api.messages(sessionId ?? ""),
    enabled: Boolean(sessionId) && enabled,
  })
}

export function useCreateSession() {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ url, idempotencyKey }: { url: string; idempotencyKey: string }) =>
      api.create(url, idempotencyKey),
    onSuccess(session) {
      queryClient.setQueryData(sessionKeys.detail(session.id), session)
      queryClient.setQueryData<SessionPages>(sessionKeys.list(""), (data) =>
        updateSessionInPages(data, session, true),
      )
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
    },
  })
}

export function useRegenerateSession(sessionId: string) {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.regenerate(sessionId),
    onSuccess(session) {
      queryClient.setQueryData(sessionKeys.detail(session.id), session)
      queryClient.setQueriesData<SessionPages>({ queryKey: sessionKeys.lists() }, (data) =>
        updateSessionInPages(data, session),
      )
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
    },
  })
}

export function useDeleteSession() {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(sessionId),
    onSuccess(_, sessionId) {
      queryClient.setQueriesData<SessionPages>({ queryKey: sessionKeys.lists() }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                sessions: page.sessions.filter((item) => item.id !== sessionId),
              })),
            }
          : data,
      )
      queryClient.removeQueries({ queryKey: sessionKeys.detail(sessionId) })
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() })
    },
  })
}

function upsertMessage(messages: MessageDto[] | undefined, message: MessageDto): MessageDto[] {
  const current = messages ?? []
  const index = current.findIndex((item) => item.id === message.id)
  if (index === -1) return [...current, message]
  return current.map((item) => (item.id === message.id ? message : item))
}

export function useSendMessage(sessionId: string) {
  const api = useSessionApi()
  const queryClient = useQueryClient()
  const controller = useRef<AbortController | null>(null)

  return useMutation({
    mutationFn: async ({
      content,
      idempotencyKey,
    }: {
      content: string
      idempotencyKey: string
    }) => {
      controller.current?.abort()
      controller.current = new AbortController()
      await api.chat(
        sessionId,
        content,
        (event) => {
          const key = sessionKeys.messages(sessionId)
          if (event.type === "chat.created") {
            queryClient.setQueryData<MessageDto[]>(key, (messages) =>
              upsertMessage(upsertMessage(messages, event.userMessage), event.assistantMessage),
            )
          } else if (event.type === "chat.delta") {
            queryClient.setQueryData<MessageDto[]>(key, (messages = []) =>
              messages.map((message) => {
                if (message.id !== event.messageId || event.offset !== message.content.length) {
                  return message
                }
                return { ...message, content: `${message.content}${event.delta}` }
              }),
            )
          } else if (event.type === "chat.reasoning") {
            queryClient.setQueryData<MessageDto[]>(key, (messages = []) =>
              messages.map((message) => {
                const reasoning = message.reasoningContent ?? ""
                if (message.id !== event.messageId || event.offset !== reasoning.length) {
                  return message
                }
                return { ...message, reasoningContent: `${reasoning}${event.delta}` }
              }),
            )
          } else {
            queryClient.setQueryData<MessageDto[]>(key, (messages) =>
              upsertMessage(messages, event.message),
            )
          }
        },
        controller.current.signal,
        idempotencyKey,
      )
    },
    onSettled() {
      controller.current = null
      void queryClient.invalidateQueries({ queryKey: sessionKeys.messages(sessionId) })
    },
  })
}

export { updateSessionInPages }
