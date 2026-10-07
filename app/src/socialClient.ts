export async function socialRequest<T>(
  route: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`/api/social/${route}`, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
