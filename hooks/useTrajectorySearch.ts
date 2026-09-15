"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseTrajectorySearchQuery,
  withTrajectorySearchType,
  type TrajectorySearchMatch,
  type TrajectorySearchResponse,
  type TrajectorySearchType,
} from "@/lib/trajectory/search-query";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 50;

interface TrajectorySearchErrorResponse {
  error?: string;
}

export interface UseTrajectorySearchOptions {
  sessionId: string | null;
  activeLeafId: string | null;
  enabled: boolean;
  open: boolean;
}

export interface UseTrajectorySearchResult {
  query: string;
  setQuery: (value: string) => void;
  type: TrajectorySearchType | "all";
  setType: (type: TrajectorySearchType | "all") => void;
  results: TrajectorySearchMatch[];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  clear: () => void;
}

/**
 * Owns the trajectory search text, type filter, and debounced server request.
 * The pane decides when the search is open; closing it clears text and results
 * so a new search always starts clean.
 */
export function useTrajectorySearch({
  sessionId,
  activeLeafId,
  enabled,
  open,
}: UseTrajectorySearchOptions): UseTrajectorySearchResult {
  const controllerRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<TrajectorySearchType | "all">("all");
  const [results, setResults] = useState<TrajectorySearchMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseTrajectorySearchQuery(query), [query]);
  const type = parsed.type === "all" ? selectedType : parsed.type;
  const term = parsed.term;

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    setQuery("");
    setSelectedType("all");
    setResults([]);
    setTotal(0);
    setTruncated(false);
    setLoading(false);
    setError(null);
  }, []);

  const changeType = useCallback((next: TrajectorySearchType | "all") => {
    setSelectedType(next);
    setQuery((current) => withTrajectorySearchType(current, next));
  }, []);

  useEffect(() => {
    if (open) return;
    clear();
  }, [clear, open]);

  useEffect(() => {
    if (!enabled || !open || !sessionId || !term) {
      controllerRef.current?.abort();
      setResults([]);
      setTotal(0);
      setTruncated(false);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    // Drop the previous query's hits before the debounce so Enter can never
    // activate a match that no longer corresponds to the typed term.
    setResults([]);
    setTotal(0);
    setTruncated(false);
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      controllerRef.current = controller;
      const params = new URLSearchParams({ q: term, limit: String(SEARCH_LIMIT) });
      if (type !== "all") params.set("types", type);
      if (activeLeafId) params.set("leafId", activeLeafId);
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory/search?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json() as TrajectorySearchResponse & TrajectorySearchErrorResponse;
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          if (controller.signal.aborted) return;
          setResults(data.matches);
          setTotal(data.total);
          setTruncated(data.truncated);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeLeafId, enabled, open, sessionId, term, type]);

  return {
    query,
    setQuery,
    type,
    setType: changeType,
    results,
    total,
    truncated,
    loading,
    error,
    clear,
  };
}
