export interface ApiOptions {
   method?: "GET" | "POST" | "PATCH";
   body?: unknown;
}

// `$fetch` is typed with every route of the app; a plain URL string is all this helper needs.
const rawFetch = $fetch as unknown as (url: string, options: object) => Promise<unknown>;

/** Calls the Mostro API (back/) with the user's Openfort access token. Throws an Error with the API's own message. */
export async function apiFetch<T>(baseURL: string, token: string | null, path: string, options: ApiOptions = {}): Promise<T> {
   try {
      return (await rawFetch(path, { ...options, baseURL, headers: token ? { Authorization: `Bearer ${token}` } : {} })) as T;
   } catch (error) {
      const data = (error as { data?: { message?: string | string[] } }).data;
      const message = Array.isArray(data?.message) ? data?.message[0] : data?.message;
      throw new Error(message ?? "Could not reach the Mostro API. Is it running?");
   }
}
