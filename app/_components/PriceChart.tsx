// Hand-drawn inline-SVG price chart: no chart library. Text lives in HTML around the SVG, so it stays crisp at
// any width; the SVG scales uniformly (viewBox) and strokes keep their width (non-scaling-stroke).
// Terminal styling: faint grid, the price line in the accent with a soft area glow, "your max" dashed in the hold
// colour, and, when the page passes one, the fake-sale spike picked out in the refuse colour.
import { LocalTime } from "./LocalTime";
import { dollars } from "./format";
import { Mono } from "./ui";

interface Point {
  priceCents: number;
  observedAt: string;
}

const W = 600;
const H = 168;
const PAD_X = 8;
const PAD_Y = 14;
const GRID_ROWS = 4;
const GRID_COLS = 6;

/** The inflated peak behind a fake-sale refusal, as already computed by the page. Display only. */
interface Spike {
  priceCents: number;
  at: string | null;
}

export function PriceChart({
  points,
  maxPriceCents,
  spike = null,
}: {
  points: Point[];
  maxPriceCents: number | null;
  spike?: Spike | null;
}) {
  const pts = points
    .map((p) => ({ t: Date.parse(p.observedAt), v: p.priceCents }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  const t0 = pts[0]?.t;
  const t1 = pts[pts.length - 1]?.t;

  if (pts.length < 2 || t0 === t1) {
    return (
      <p className="max-w-prose text-muted">
        No price history yet — the agent records the price each time it checks. Run a few checks to see the trend.
      </p>
    );
  }

  const values = pts.map((p) => p.v);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = pts[pts.length - 1].v;

  // The "your max" line joins the scale only when it is near the data; if it is far above, squeezing every
  // price into the bottom of the chart would hide the trend, so it is described in words instead.
  const maxInView = maxPriceCents !== null && maxPriceCents <= high * 1.5;
  let lo = maxInView ? Math.min(low, maxPriceCents) : low;
  let hi = maxInView ? Math.max(high, maxPriceCents) : high;
  const pad = (hi - lo || hi * 0.1 || 1) * 0.1;
  lo -= pad;
  hi += pad;

  const x = (t: number) => PAD_X + ((t - t0) / (t1 - t0)) * (W - 2 * PAD_X);
  const y = (v: number) => PAD_Y + ((hi - v) / (hi - lo)) * (H - 2 * PAD_Y);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${x(last.t).toFixed(1)} ${H} L${x(pts[0].t).toFixed(1)} ${H} Z`;

  // The spike point: the observation at the inflated peak price (at its timestamp when known).
  const spikeAt = spike?.at ? Date.parse(spike.at) : NaN;
  let spikeIdx = spike ? pts.findIndex((p) => p.v === spike.priceCents && p.t === spikeAt) : -1;
  if (spike && spikeIdx < 0) spikeIdx = pts.findIndex((p) => p.v === spike.priceCents);
  // The spike runs from the point before the peak, across any plateau at the peak price, to the point after it.
  let spikeEnd = spikeIdx;
  while (spikeEnd >= 0 && spikeEnd + 1 < pts.length && pts[spikeEnd + 1].v === pts[spikeIdx].v) spikeEnd++;
  const spikePath =
    spikeIdx >= 0
      ? pts
          .slice(Math.max(0, spikeIdx - 1), spikeEnd + 2)
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
          .join(" ")
      : null;
  const spikePt = spikeIdx >= 0 ? pts[spikeIdx] : null;

  let verdict: string | null = null;
  if (maxPriceCents !== null) {
    const diff = maxPriceCents - latest;
    verdict =
      diff > 0
        ? `Latest is ${dollars(diff)} under your max.`
        : diff < 0
          ? `Latest is ${dollars(-diff)} over your max.`
          : "Latest is exactly your max.";
  }

  return (
    <figure>
      <dl className="mb-5 grid grid-cols-3 border border-border">
        {[
          ["Low", low],
          ["High", high],
          ["Latest", latest],
        ].map(([label, value]) => (
          <div key={label as string} className="flex flex-col gap-1.5 border-l border-border px-3 py-2.5 first:border-l-0 sm:px-4">
            <dt className="type-eyebrow text-muted">{label}</dt>
            <dd>
              <Mono
                className={`text-base sm:text-xl ${label === "Latest" ? "font-semibold text-accent" : "text-ink"}`}
              >
                {dollars(value as number)}
              </Mono>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border border-border bg-bg/60">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Price history from ${dollars(low)} to ${dollars(high)}, latest ${dollars(latest)}${
            maxPriceCents !== null ? `, your max ${dollars(maxPriceCents)}` : ""
          }`}
        >
          <defs>
            <linearGradient id="price-area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)" }} stopOpacity={0.28} />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity={0} />
            </linearGradient>
            <filter id="price-line-glow" x="-5%" y="-30%" width="110%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          {Array.from({ length: GRID_ROWS - 1 }, (_, i) => (H / GRID_ROWS) * (i + 1)).map((gy) => (
            <line key={`r${gy}`} x1={0} x2={W} y1={gy} y2={gy} className="stroke-border" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
          ))}
          {Array.from({ length: GRID_COLS - 1 }, (_, i) => (W / GRID_COLS) * (i + 1)).map((gx) => (
            <line key={`c${gx}`} x1={gx} x2={gx} y1={0} y2={H} className="stroke-border" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
          ))}

          {maxInView && (
            <rect
              x={0}
              y={y(maxPriceCents)}
              width={W}
              height={Math.max(0, H - y(maxPriceCents))}
              className="fill-buy"
              fillOpacity={0.04}
            />
          )}

          <path d={area} fill="url(#price-area-fill)" />
          <path
            d={line}
            fill="none"
            className="stroke-accent"
            strokeWidth={6}
            strokeOpacity={0.35}
            filter="url(#price-line-glow)"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {maxInView && (
            <line
              x1={0}
              x2={W}
              y1={y(maxPriceCents)}
              y2={y(maxPriceCents)}
              className="stroke-hold"
              strokeOpacity={0.8}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

          {spikePath && spikePt && (
            <>
              <line
                x1={x(spikePt.t)}
                x2={x(spikePt.t)}
                y1={y(spikePt.v)}
                y2={H}
                className="stroke-refuse"
                strokeOpacity={0.45}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <path d={spikePath} fill="none" className="stroke-refuse" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </>
          )}

          {pts.length <= 24 &&
            pts
              .slice(0, -1)
              .map((p, i) => (
                <circle
                  key={p.t}
                  cx={x(p.t)}
                  cy={y(p.v)}
                  r={i >= spikeIdx && i <= spikeEnd && spikeIdx >= 0 ? 4 : 2.5}
                  className={i >= spikeIdx && i <= spikeEnd && spikeIdx >= 0 ? "fill-refuse stroke-bg" : "fill-bg stroke-accent"}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          <circle cx={x(last.t)} cy={y(last.v)} r={9} className="fill-accent" fillOpacity={0.18} />
          <circle cx={x(last.t)} cy={y(last.v)} r={4.5} className="fill-accent stroke-bg" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <div className="mt-2 flex justify-between text-[0.6875rem] text-muted">
        <Mono>
          <LocalTime iso={new Date(t0).toISOString()} mode="date" />
        </Mono>
        <Mono>
          <LocalTime iso={new Date(t1).toISOString()} mode="date" />
        </Mono>
      </div>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" x2="22" y1="3" y2="3" className="stroke-accent" strokeWidth={2} />
          </svg>
          price
        </span>
        {maxPriceCents !== null && (
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" x2="22" y1="3" y2="3" className="stroke-hold" strokeOpacity={0.8} strokeDasharray="5 4" strokeWidth={1.5} />
            </svg>
            your max <Mono className="text-ink-2">{dollars(maxPriceCents)}</Mono>
            {!maxInView && " (far above these prices)"}
          </span>
        )}
        {spikePt && (
          <span className="inline-flex items-center gap-2 text-refuse">
            <span aria-hidden className="h-2 w-2 rounded-full bg-refuse" />
            raised to <Mono>{dollars(spikePt.v)}</Mono>
          </span>
        )}
        {verdict && <span className="basis-full text-ink-2 sm:basis-auto">{verdict}</span>}
      </figcaption>
    </figure>
  );
}
