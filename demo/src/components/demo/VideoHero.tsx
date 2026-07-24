import { useRef, useState } from "react";
import { asset } from "../../lib/asset";

// The landing centerpiece: the polished ~4-minute product film that shows the
// whole teaching loop running end to end. Sits high on the "/" front door,
// directly under the value-prop lede and above the interactive flow spine —
// the founder can just press play instead of narrating.
//
// Editorial + premium to match the brand: sienna eyebrow, big serif headline,
// and the film framed as a floating window (rounded corners, soft shadow) that
// echoes the video's own aesthetic. Click-to-play with the poster (not
// muted-autoplay) — this is a deliberate ~4-minute film you sit and watch, not
// wallpaper. It's silent by design: there's no narration or score — burned-in
// captions carry the story, so it reads with the sound off (audio still routes
// through the native controls if a future cut adds any). A custom play
// affordance covers only the pristine poster state; once the film has started,
// native controls take over fully.

export default function VideoHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    // User-gesture play; swallow the rejection if the browser blocks it
    // (e.g. codec/autoplay policy) rather than logging an unhandled rejection.
    videoRef.current?.play().catch(() => {});
  }

  return (
    <section className="dh-video" aria-labelledby="dh-video-title">
      <div className="dh-video-head">
        <span className="dh-video-eyebrow">The film · 4 minutes</span>
        <h2 id="dh-video-title" className="dh-video-headline">
          Watch Veradic run a teacher's whole day — start to finish.
        </h2>
        <p className="dh-video-sub">
          From snapping the homework to the class you can see at a glance. The
          full loop, in under four minutes.
        </p>
      </div>

      <figure className={`dh-video-frame${started ? " is-playing" : ""}`}>
        <video
          ref={videoRef}
          className="dh-video-el"
          poster={asset("/veradic-cycle-poster.jpg")}
          controls
          preload="metadata"
          playsInline
          onPlay={() => setStarted(true)}
        >
          <source src={asset("/veradic-cycle.mp4")} type="video/mp4" />
          Your browser doesn’t support embedded video. The Veradic product film
          shows the full teaching loop, end to end.
        </video>

        {!started && (
          <button
            type="button"
            className="dh-video-play"
            onClick={play}
            aria-label="Play the Veradic product film"
          >
            <span className="dh-video-play-ring" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                <path d="M8 5.5v13l11-6.5L8 5.5z" fill="currentColor" />
              </svg>
            </span>
            <span className="dh-video-play-label">Play the film</span>
          </button>
        )}
      </figure>
    </section>
  );
}
