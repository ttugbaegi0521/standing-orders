// Hand-drawn inline-SVG price chart: no chart library. Text lives in HTML around the SVG, so it stays crisp at
// any width; the SVG scales uniformly (viewBox) and strokes keep their width (non-scaling-stroke).
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
const INK = "#1c1b19";
const ACCENT = "#2748d4";

export function PriceChart({ points, maxPriceCents }: { points: Point[]; maxPriceCents: number | null }) {
  const pts = points
    .map((p) => ({ t: Date.parse(p.observedAt), v: p.priceCents }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  const t0 = pts[0]?.t;
  const t1 = pts[pts.length - 1]?.t;

  if (pts.length < 2 || t0 === t1) {
    return (
      <p className="max-w-prose text-[#6b6a64]">
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
      <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {[
          ["Low", low],
          ["High", high],
          ["Latest", latest],
        ].map(([label, value]) => (
          <div key={label as string} className="flex items-baseline gap-2">
            <dt className="text-[#6b6a64]">{label}</dt>
            <dd>
              <Mono className={label === "Latest" ? "font-medium" : ""}>{dollars(value as number)}</Mono>
            </dd>
          </div>
        ))}
      </dl>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Price history from ${dollars(low)} to ${dollars(high)}, latest ${dollars(latest)}${
          maxPriceCents !== null ? `, your max ${dollars(maxPriceCents)}` : ""
        }`}
      >
        {maxInView && (
          <rect
            x={0}
            y={y(maxPriceCents)}
            width={W}
            height={Math.max(0, H - y(maxPriceCents))}
            fill={ACCENT}
            fillOpacity={0.07}
          />
        )}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#e7e5df" vectorEffect="non-scaling-stroke" />
        {maxInView && (
          <line
            x1={0}
            x2={W}
            y1={y(maxPriceCents)}
            y2={y(maxPriceCents)}
            stroke={INK}
            strokeOpacity={0.6}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {pts.length <= 24 &&
          pts.slice(0, -1).map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={2.5} fill="#fbfaf7" stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
        <circle cx={x(last.t)} cy={y(last.v)} r={5} fill={ACCENT} stroke="#fbfaf7" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="mt-2 flex justify-between text-xs text-[#6b6a64]">
        <Mono>
          <LocalTime iso={new Date(t0).toISOString()} mode="date" />
        </Mono>
        <Mono>
          <LocalTime iso={new Date(t1).toISOString()} mode="date" />
        </Mono>
      </div>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[#6b6a64]">
        {maxPriceCents !== null && (
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" x2="22" y1="3" y2="3" stroke={INK} strokeOpacity={0.6} strokeDasharray="5 4" strokeWidth={1.5} />
            </svg>
            your max <Mono>{dollars(maxPriceCents)}</Mono>
            {!maxInView && " (far above these prices)"}
          </span>
        )}
        {verdict && <span>{verdict}</span>}
      </figcaption>
    </figure>
  );
}
