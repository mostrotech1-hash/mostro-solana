import type { ApiError, ApiErrorCode } from "@mostro/shared/api";

export interface ApiOptions {
   method?: "GET" | "POST" | "PATCH";
   body?: unknown;
}

/** An error answered by the Mostro API: the message is safe to show, `code` and `data` let the app react to it. */
export class ApiRequestError extends Error {
   constructor(
      message: string,
      readonly status: number | null,
      readonly code: ApiErrorCode | undefined,
      readonly data: Partial<ApiError> | undefined,
   ) {
      super(message);
   }
}

// `$fetch` is typed with every route of the app; a plain URL string is all this helper needs.
const rawFetch = $fetch as unknown as (url: string, options: object) => Promise<unknown>;

/** Calls the Mostro API (back/) with the user's Openfort access token. Throws an ApiRequestError with the API's own message. */
export async function apiFetch<T>(baseURL: string, token: string | null, path: string, options: ApiOptions = {}): Promise<T> {
   try {
      return (await rawFetch(path, { ...options, baseURL, headers: token ? { Authorization: `Bearer ${token}` } : {} })) as T;
   } catch (error) {
      const failure = error as { data?: Partial<ApiError> & { message?: string | string[] }; statusCode?: number; status?: number };
      const data = failure.data;
      const message = Array.isArray(data?.message) ? data?.message[0] : data?.message;
      throw new ApiRequestError(
         message ?? "Could not reach the Mostro API. Is it running?",
         failure.statusCode ?? failure.status ?? null,
         data?.code,
         data as Partial<ApiError> | undefined,
      );
   }
}
