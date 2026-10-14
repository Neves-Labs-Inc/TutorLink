export type SingleFlight = {
  // True when the caller won the slot; false while another run is in flight.
  tryStart: () => boolean
  finish: () => void
}

// Synchronous on purpose: React state and TanStack's isPending lag a tick behind a fast second activation.
export function createSingleFlight(): SingleFlight {
  let isInFlight = false

  return {
    tryStart: () => {
      if (isInFlight) return false
      isInFlight = true
      return true
    },
    finish: () => {
      isInFlight = false
    },
  }
}
