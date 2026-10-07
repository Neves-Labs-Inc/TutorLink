import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE, type Page } from '@/lib/queries/page'
import type { Language } from '@/lib/reminders/reminders'

export type ConversationStatus = 'bot' | 'human'
export type FlagReason =
  | 'stuck'
  | 'parse_error'
  | 'guardian_link_request'
  | 'reactivation_request'
  | 'booking_request'
  | 'question'
export type MessageAuthorKind = 'client' | 'bot' | 'admin' | 'system'
export type MessageStatus = 'received' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
export type SystemMessageKind =
  | 'takeover_notice'
  | 'transfer_notice'
  | 'handback_notice'
  | 'booking_reminder'
  | 'consent_notice'

export type ConversationGuardianRef = { id: string; name: string }
// The API's `UserRef`: a Staff member is named by Display name, never by email.
export type ConversationAdminRef = { id: string; display_name: string }

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
  is_window_open: boolean
  last_client_message_at: string | null
  language: Language | null
}

export type Message = {
  id: string
  author_kind: MessageAuthorKind
  author: ConversationAdminRef | null
  body: string
  status: MessageStatus
  created_at: string
  system_kind: SystemMessageKind | null
  error_code: string | null
  reminder_child_names: string[] | null
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

export const transferConversation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${conversationId}/transfer`,
  )

  return response.data
}

export const updateConversationLanguage = async (
  conversationId: string,
  language: Language | null,
): Promise<ConversationDetail> => {
  const response = await api.patch<ConversationDetail>(`/api/conversations/${conversationId}`, {
    language,
  })

  return response.data
}

export const retryNotice = async (conversationId: string, messageId: string): Promise<Message> => {
  const response = await api.post<Message>(
    `/api/conversations/${conversationId}/messages/${messageId}/retry`,
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
