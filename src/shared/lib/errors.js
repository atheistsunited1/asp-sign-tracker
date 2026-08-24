function normalized(input) {
  return String(input || '').trim().toLowerCase()
}

export function errorToUserMessage(error, fallback = 'Something went wrong. Please try again.') {
  const msg = normalized(error?.message || error)
  if (!msg) return fallback

  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('timeout')
  ) {
    return 'Network issue. Please check your connection and try again.'
  }

  if (
    msg.includes('not authorized') ||
    msg.includes('forbidden') ||
    msg.includes('permission') ||
    msg.includes('jwt')
  ) {
    return 'You do not have permission to perform this action.'
  }

  if (
    msg.includes('duplicate key') ||
    msg.includes('already exists') ||
    msg.includes('unique')
  ) {
    return 'That item already exists.'
  }

  if (msg.includes('not found')) {
    return 'The requested item was not found.'
  }

  return fallback
}

