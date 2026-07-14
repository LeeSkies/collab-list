export type Role = 'admin' | 'member'

export interface Profile {
  id: string
  name: string
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
  ordering_at: string
  version: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}
