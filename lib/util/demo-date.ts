/**
 * Presentation-only date override for the hackathon demo.
 *
 * The account pages show a member-since date and a date per game. During a
 * demo those are meaningless — accounts are minutes old and every game was
 * created during setup — so they are pinned to the event date instead of
 * showing timestamps that undercut the story.
 *
 * This is deliberately cosmetic and confined to two call sites. Nothing here
 * touches stored data, scoring, settlement, or anything the server decides:
 * the real `createdAt` is still recorded and still used for ordering. Delete
 * this module and inline `new Date(value)` at both call sites to go back to
 * real dates.
 */

/** The event date every account page displays. */
const DEMO_DATE = new Date(Date.UTC(2026, 7, 29)); // 29 August 2026

/** Long form, e.g. "29 August 2026". Used for "Member since". */
export function formatDemoDateLong(): string {
  return DEMO_DATE.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Short form for dense rows, e.g. "29 Aug 2026". Used per game. */
export function formatDemoDateShort(): string {
  return DEMO_DATE.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
