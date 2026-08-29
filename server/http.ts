import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { getSessionUser, type SessionUser } from '@/lib/auth/session';
import { RoomError } from '@/server/rooms';
import { firstIssue } from '@/lib/validation';

/**
 * Route-handler plumbing: consistent JSON envelopes, one place that turns a
 * thrown error into the right status code, and the auth guard every privileged
 * endpoint uses.
 */

export interface ApiError {
  error: string;
  code: string;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function fail(message: string, status = 400, code = 'BAD_REQUEST'): NextResponse {
  return NextResponse.json({ error: message, code } satisfies ApiError, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** 401 when nobody is signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError('Sign in to continue', 401, 'UNAUTHENTICATED');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    throw new HttpError('Admin access required', 403, 'FORBIDDEN');
  }
  return user;
}

/**
 * Parse and validate a JSON body.
 *
 * Generic over the schema rather than its type so schemas with defaults infer
 * their OUTPUT type — the shape after defaults are applied.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError('Expected a JSON body', 400, 'BAD_JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(firstIssue(parsed.error), 400, 'VALIDATION');
  }
  return parsed.data;
}

/**
 * Wrap a handler so domain errors become the right response and unexpected
 * failures are logged server-side but never leak internals to the client.
 */
export async function handle(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status, error.code);
    if (error instanceof RoomError) return fail(error.message, error.status, error.code);
    if (error instanceof ZodError) return fail(firstIssue(error), 400, 'VALIDATION');
    console.error('[buzzin] unhandled route error', error);
    return fail('Something went wrong. Please try again.', 500, 'INTERNAL');
  }
}
