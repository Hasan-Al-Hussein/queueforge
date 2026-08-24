'use client';

import { useSearchParams } from 'next/navigation';

export interface StaticSearchParam {
  readonly ready: boolean;
  readonly value: string | null;
}

export function useStaticSearchParam(name: string): StaticSearchParam {
  const searchParams = useSearchParams();
  return { ready: true, value: searchParams.get(name) };
}
