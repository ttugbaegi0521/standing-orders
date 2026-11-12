// Hand-drawn inline-SVG price chart: no chart library. Text lives in HTML around the SVG, so it stays crisp at
// any width; the SVG scales uniformly (viewBox) and strokes keep their width (non-scaling-stroke). Axis labels are
// HTML too, positioned by percentage of the plot height so they line up with the gridlines at every width.
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

/** A "nice" gridline step (1, 2 or 5 × a power of ten) giving about four rows between lo and hi. */
function niceStep(range: number): number {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/** Axis labels drop the cents when every tick is a whole dollar. */
function axisLabel(cents: number, wholeDollars: boolean): string {
  return wholeDollars ? `$${Math.round(cents / 100).toLocaleString("en-US")}` : dollars(cents);
}

export function PriceChart({ points, maxPriceCents }: { points: Point[]; maxPriceCents: number | null }) {
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

  const step = Math.max(1, niceStep(hi - lo));
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const wholeDollars = ticks.every((v) => v % 100 === 0);

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
      <dl className="mb-5 grid grid-cols-3 overflow-hidden rounded-md border border-rule bg-surface">
        {[
          ["Low", low],
          ["High", high],
          ["Latest", latest],
        ].map(([label, value]) => (
          <div key={label as string} className="flex flex-col gap-1 border-l border-rule px-3 py-2.5 first:border-l-0 sm:px-4">
            <dt className="type-eyebrow text-muted">{label}</dt>
            <dd>
              <Mono className={`text-base font-medium sm:text-lg ${label === "Latest" ? "text-accent" : "text-ink"}`}>
                {dollars(value as number)}
              </Mono>
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div aria-hidden className="relative w-12 text-right font-mono text-[0.6875rem] tabular-nums text-muted">
          {ticks.map((v, i) => (
            <span
              key={v}
              className={`absolute right-0 -translate-y-1/2 leading-none ${i % 2 === 1 ? "max-sm:hidden" : ""}`}
              style={{ top: `${(y(v) / H) * 100}%` }}
            >
              {axisLabel(v, wholeDollars)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full overflow-visible"
          role="img"
          aria-label={`Price history from ${dollars(low)} to ${dollars(high)}, latest ${dollars(latest)}${
            maxPriceCents !== null ? `, your max ${dollars(maxPriceCents)}` : ""
          }`}
        >
          <defs>
            <linearGradient id="price-area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)" }} stopOpacity={0.14} />
              <stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} className="stroke-rule" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-rule-strong" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="url(#price-area-fill)" />
          {maxInView && (
            <line
              x1={0}
              x2={W}
              y1={y(maxPriceCents)}
              y2={y(maxPriceCents)}
              className="stroke-ink-2"
              strokeOpacity={0.55}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {pts.length <= 24 &&
            pts.slice(0, -1).map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={2.5} className="fill-surface stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
          <circle cx={x(last.t)} cy={y(last.v)} r={8} className="fill-accent" fillOpacity={0.15} />
          <circle cx={x(last.t)} cy={y(last.v)} r={4.5} className="fill-accent stroke-surface" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>

        <div className="col-start-2 mt-2 flex justify-between text-[0.6875rem] text-muted">
          <Mono>
            <LocalTime iso={new Date(t0).toISOString()} mode="date" />
          </Mono>
          <Mono>
            <LocalTime iso={new Date(t1).toISOString()} mode="date" />
          </Mono>
        </div>
      </div>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-rule pt-3 text-[0.8125rem] text-muted">
        {maxPriceCents !== null && (
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" x2="22" y1="3" y2="3" className="stroke-ink-2" strokeOpacity={0.55} strokeDasharray="5 4" strokeWidth={1.5} />
            </svg>
            your max <Mono className="text-ink">{dollars(maxPriceCents)}</Mono>
            {!maxInView && " (far above these prices)"}
          </span>
        )}
        {verdict && <span className="text-ink-2">{verdict}</span>}
      </figcaption>
    </figure>
  );
}
