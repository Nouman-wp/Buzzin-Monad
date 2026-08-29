/**
 * Class-name joiner.
 *
 * Lives outside the client component module so server components (the landing
 * page, the brand mark) can use it too. Importing it from a `'use client'`
 * file would make it a client reference and fail to render on the server.
 */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
