import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Phase 2: silent refresh on 401
    return Promise.reject(error)
  },
)
