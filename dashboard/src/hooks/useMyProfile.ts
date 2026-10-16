import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { meQueries, updateMe } from '@/lib/queries/me'

// Every other cached query that renders a Staff name: holder and author labels live under
// `conversations`, level and Evaluated "by" lines under `children`, and the Users table under `users`.
const NAME_BEARING_QUERY_KEYS = [['conversations'], ['children'], ['users']] as const

export const useMyProfile = () => {
  const queryClient = useQueryClient()
  const me = useQuery(meQueries.detail())

  const save = useMutation({
    mutationFn: updateMe,
    onSuccess: async (updated) => {
      // Cancel first so a GET already in flight can't land after and restore the old name.
      await queryClient.cancelQueries({ queryKey: meQueries.detail().queryKey })
      // Written straight in so the shell's name card changes before any refetch lands.
      queryClient.setQueryData(meQueries.detail().queryKey, updated)
      for (const queryKey of NAME_BEARING_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return { me, save }
}
