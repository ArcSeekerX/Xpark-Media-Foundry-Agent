import { useCallback } from 'react'
import type { DeployRequest, DeployResponse, Deployment } from '../types/api'
import { apiDelete, apiPost, useGet } from './useApi'

export function useDeployments() {
  const { data: deployments, loading, error, refetch } = useGet<Deployment[]>('/api/deploy', 5000)

  const deploy = useCallback(async (req: DeployRequest): Promise<DeployResponse> => {
    const result = await apiPost<DeployResponse>('/api/deploy', req)
    refetch()
    return result
  }, [refetch])

  const stopDeployment = useCallback(async (id: string) => {
    await apiDelete(`/api/deploy/${id}`)
    refetch()
  }, [refetch])

  /** Fetch a deployment's accumulated logs. `last` limits to the most recent
   *  N lines (sliding window); omit for all. */
  const fetchLogs = useCallback(async (id: string, last?: number): Promise<string[]> => {
    try {
      const q = last ? `?last=${last}` : ''
      const res = await fetch(`/api/deploy/${id}/logs${q}`)
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data.lines) ? data.lines : []
    } catch {
      return []
    }
  }, [])

  return { deployments, loading, error, deploy, stopDeployment, fetchLogs, refetch }
}
