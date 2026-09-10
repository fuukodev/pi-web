export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
  subsessionId: string | null;
}

export function getInitialNavigation(searchParams: Pick<URLSearchParams, "get">): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;
  const sessionId = requestedCwd ? null : searchParams.get("session");

  return {
    requestedCwd,
    sessionId,
    subsessionId: sessionId ? searchParams.get("subsession") : null,
  };
}
