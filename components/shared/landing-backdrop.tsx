import Image from 'next/image';
import backdrop from '@/public/images/landing-bg.jpg';

/**
 * Landing-page backdrop.
 *
 * A fixed photographic layer with the page's own dimming stack on top. It sits
 * behind the content but above the global ambient wash, so the violet glow
 * still reads through the darker areas.
 *
 * Three deliberate choices:
 *
 *   - `next/image` rather than a CSS background. It re-encodes to AVIF or WebP
 *     and emits a responsive srcset, so a 1440p screen gets a sharper file than
 *     a phone does instead of both downloading the same JPEG. `priority` marks
 *     it for preload — it is the largest thing on the first screen.
 *
 *   - `position: fixed` on the wrapper rather than `background-attachment:
 *     fixed`, which iOS Safari either ignores or renders with visible jank
 *     while scrolling. This gives the same parallax-free effect everywhere.
 *
 *   - No blur. The source is 1280x720, which is a 1.5x upscale on a 1080p
 *     viewport — close enough to native that softening it would only throw
 *     away detail. A small contrast and saturation lift compensates for what
 *     the dimming stack flattens.
 *
 * Mobile first: a 16:9 image cropped to a portrait viewport keeps only a narrow
 * slice, so the focal point sits above centre on small screens and the dimming
 * is a little heavier there — a phone is usually the worst-lit screen in the
 * room, and text contrast matters more than the picture. Most of the legibility
 * comes from the vignette rather than a flat scrim, which keeps the photograph
 * readable as a photograph while still protecting the copy.
 */
export function LandingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Image
        src={backdrop}
        alt=""
        fill
        priority
        quality={90}
        sizes="100vw"
        placeholder="blur"
        className="
          object-cover contrast-[1.06] saturate-[1.12]
          [object-position:50%_35%] sm:[object-position:50%_45%]
        "
      />

      {/* Flat dim. Light enough that the photograph reads as a photograph. */}
      <div className="absolute inset-0 bg-ink-950/45 sm:bg-ink-950/38" />

      {/* Vertical falloff. The picture stays open through the middle; the ends
          darken so the header and footer keep their contrast. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/85 via-transparent to-ink-950/90" />

      {/* Vignette, so the centred hero copy sits on the calmest part. This is
          what buys legibility now that the flat dim is doing less of the work. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(115% 85% at 50% 40%, color-mix(in srgb, var(--color-ink-950) 34%, transparent) 0%, color-mix(in srgb, var(--color-ink-950) 22%, transparent) 38%, color-mix(in srgb, var(--color-ink-950) 72%, transparent) 100%)',
        }}
      />
    </div>
  );
}
