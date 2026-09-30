import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'

export type ConversationStatus = 'bot' | 'human'
export type FlagReason = 'stuck' | 'parse_error' | 'guardian_link_request' | 'reactivation_request'
export type MessageAuthorKind = 'client' | 'bot' | 'admin'
export type MessageStatus = 'received' | 'queued' | 'sent' | 'delivered' | 'failed'

export type ConversationGuardianRef = { id: string; name: string }
export type ConversationAdminRef = { id: string; email: string }

export type ReactivationRequest = {
  child: { id: string; name: string; is_active: boolean }
}

export type Conversation = {
  id: string
  phone_number: string
  guardian: ConversationGuardianRef | null
  status: ConversationStatus
  taken_over_by: ConversationAdminRef | null
  last_message_at: string
  last_message_preview: string
  unread: boolean
  flag_reason: FlagReason | null
}

export type ConversationDetail = Omit<Conversation, 'last_message_preview' | 'unread'> & {
  taken_over_at: string | null
  last_read_at: string
  message_count: number
  unread_count: number
  created_at: string
  reactivation_request: ReactivationRequest | null
  flagged_at: string | null
}

export type Message = {
  id: string
  author_kind: MessageAuthorKind
  author: ConversationAdminRef | null
  body: string
  status: MessageStatus
  created_at: string
}

export type ConversationListParams = {
  status?: ConversationStatus
  unread?: boolean
  flagged?: boolean
  q?: string
  page?: number
  page_size?: number
}

export type ConversationMessageListParams = {
  before?: string
  page?: number
  page_size?: number
}

export const approveReactivation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${conversationId}/reactivation/approve`,
  )

  return response.data
}

export const denyReactivation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${conversationId}/reactivation/deny`,
  )

  return response.data
}

export const conversationQueries = {
  list: (params: ConversationListParams = {}) =>
    queryOptions({
      queryKey: ['conversations', 'list', params],
      queryFn: async () => {
        const response = await api.get<Page<Conversation>>('/api/conversations', {
          params: { page_size: DEFAULT_PAGE_SIZE, ...params },
        })

        return response.data
      },
      placeholderData: keepPreviousData,
    }),

  detail: (conversationId: string) =>
    queryOptions({
      queryKey: ['conversations', 'detail', conversationId],
      queryFn: async () => {
        const response = await api.get<ConversationDetail>(
          `/api/conversations/${conversationId}`,
        )

        return response.data
      },
    }),

  messages: (conversationId: string, params: ConversationMessageListParams = {}) =>
    queryOptions({
      queryKey: ['conversations', 'detail', conversationId, 'messages', params],
      queryFn: async () => {
        const response = await api.get<Page<Message>>(
          `/api/conversations/${conversationId}/messages`,
          { params: { page_size: DEFAULT_PAGE_SIZE, ...params } },
        )

        return response.data
      },
      placeholderData: keepPreviousData,
    }),
}
