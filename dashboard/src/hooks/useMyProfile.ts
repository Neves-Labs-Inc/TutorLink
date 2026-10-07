import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { meQueries, updateMe } from '@/lib/queries/me'

// Every cached query that renders a Staff name: holder and author labels live under
// `conversations`, level and Evaluated "by" lines under `children`, and the Users table under `users`.
const NAME_BEARING_QUERY_KEYS = [['me'], ['conversations'], ['children'], ['users']] as const

export const useMyProfile = () => {
  const queryClient = useQueryClient()
  const me = useQuery(meQueries.detail())

  const save = useMutation({
    mutationFn: updateMe,
    onSuccess: () => {
      for (const queryKey of NAME_BEARING_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return { me, save }
}
