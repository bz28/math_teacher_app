// A soft browser-window chrome around a product screenshot. Keeps the
// real captures feeling like live product, not loose images. The `tone`
// prop lets the hero moment lift the frame with an accent ring.

export default function BrowserFrame({
  src,
  alt,
  tone = "default",
  url = "app.veradic.com",
  eager = false,
}: {
  src: string;
  alt: string;
  tone?: "default" | "moment";
  url?: string;
  eager?: boolean;
}) {
  return (
    <figure className={`it-frame it-frame-${tone}`}>
      <div className="it-frame-bar">
        <span className="it-frame-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="it-frame-url mono">{url}</span>
      </div>
      <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} />
    </figure>
  );
}
