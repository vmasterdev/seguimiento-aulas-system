'use client';

import useSWR, { type SWRConfiguration } from 'swr';

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function useFetch<T>(
  url: string | null,
  options?: SWRConfiguration,
) {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    ...options,
  });

  return {
    data,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    loading: isLoading,
    refresh: mutate,
  };
}
