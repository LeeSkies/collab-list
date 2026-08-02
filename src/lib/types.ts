import type { ProductCategory } from './product-category'

export type Role = 'admin' | 'member'

export interface Profile {
  id: string
  household_id?: string
  name: string
  email: string
  role: Role
  product_tour_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  household_id: string
  id: string
  name: string
  name_signature: string
  quantity: string
  notes: string | null
  category: ProductCategory
  is_picked: boolean
  picked_at: string | null
  ordering_at: string
  version: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ProductChanges {
  name: string
  quantity: string
  notes: string
  category: ProductCategory
}

export interface HouseholdMembership {
  household_id: string
  user_id: string
  role: Role
  created_at: string
  updated_at: string
}

export interface HouseholdCreation {
  household_id: string
  household_name: string
  trial_starts_at: string
  trial_ends_at: string
}

export type HouseholdAccessState =
  'active_trial' | 'read_only_grace' | 'unavailable_locked' | 'paid_placeholder'

export interface HouseholdEntitlement {
  household_id: string
  access_state: HouseholdAccessState
  trial_starts_at: string | null
  trial_ends_at: string | null
  grace_ends_at: string | null
  seat_limit: 5
  enforcement_enabled: boolean
  can_mutate: boolean
  reads_available: boolean
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}

export interface HouseholdInvite {
  token: string
  expiresAt: string
}

export interface HouseholdInvitePreview {
  householdName: string
  approvalRequired: boolean
}

export type HouseholdRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface HouseholdRequestState {
  requestId: string | null
  householdName: string
  status: HouseholdRequestStatus
  expiresAt: string | null
}

export interface PendingHouseholdRequest {
  requestId: string
  name: string
  email: string
  requestedAt: string
  expiresAt: string
}
