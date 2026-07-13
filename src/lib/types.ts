export type Role = 'admin' | 'member'

export interface Profile {
  id: string
  email: string
  role: Role
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  name: string
  name_signature: string
  quantity: string
  notes: string | null
  is_picked: boolean
  picked_at: string | null
  picked_by: string | null
  ordering_at: string
  version: number
  created_at: string
  updated_at: string
}

export interface PickHistory {
  id: string
  product_id: string
  picked_at: string
  picked_by: string | null
  picked_by_email: string
  created_at: string
}

export interface AdminUser {
  id: string
  email: string
  role: Role
  createdAt: string
}
