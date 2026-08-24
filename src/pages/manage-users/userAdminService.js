import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { getUser as getAuthUser, resetPasswordForEmail as sendAuthResetPassword } from '@/shared/auth/authService'

export function listPendingUsers() {
  return profilesRepo.rpcAdminListProfiles(true)
}

export function listAllUsers() {
  return profilesRepo.rpcAdminListProfiles(false)
}

export function getCurrentAuthUser() {
  return getAuthUser()
}

export function approveUser({ id, payload }) {
  return profilesRepo.updateById(id, payload)
}

export function updateUser({ id, payload }) {
  return profilesRepo.updateById(id, payload)
}

export function deleteUserById(id) {
  return profilesRepo.deleteById(id)
}

export function sendResetPasswordEmail(email, redirectTo) {
  return sendAuthResetPassword(email, { redirectTo })
}
