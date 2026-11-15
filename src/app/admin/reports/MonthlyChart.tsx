import { shortMonthNames } from "@/lib/report-period";

export type ChartSeries = {
  label: string;
  color: string;
  values: number[];
};

type Props = {
  title: string;
  months: string[]; // YYYY-MM-DD (first day)
  series: ChartSeries[];
  format: (value: number) => string;
};

// Server-rendered bar chart (one value axis, grouped bars per month).
// Each month has a full-height hover area with a tooltip; the numbers are
// also in the table below the charts.
export default function MonthlyChart({ title, months, series, format }: Props) {
  const width = 640;
  const height = 220;
  const pad = { top: 20, right: 8, bottom: 30, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...series.flatMap((item) => item.values));
  const scaleMax = max > 0 ? niceCeil(max) : 1;
  const slot = plotW / Math.max(months.length, 1);
  const groupW = Math.min(slot * 0.7, 56);
  const gap = 2;
  const barW = Math.max((groupW - gap * (series.length - 1)) / series.length, 2);
  const y = (value: number) => pad.top + plotH - (value / scaleMax) * plotH;
  // Label only the highest value of the first series.
  const peak = series[0]?.values.indexOf(Math.max(...(series[0]?.values ?? [0])));

  return (
    <figure className="card min-w-0 p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-white">{title}</span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs text-zinc-400">
            {series.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <p className="mt-0.5 text-xs text-zinc-500">Ən yüksək: {format(max)}</p>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label={`${title}: ${months
          .map((month, i) => `${monthText(month)} ${series.map((item) => `${item.label} ${format(item.values[i] ?? 0)}`).join(", ")}`)
          .join("; ")}`}
      >
        {[0.5, 1].map((t) => (
          <line
            key={t}
            x1={pad.left}
            x2={width - pad.right}
            y1={y(scaleMax * t)}
            y2={y(scaleMax * t)}
            stroke="#27272a"
            strokeDasharray="3 4"
          />
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#3f3f46" />

        {months.map((month, i) => {
          const center = pad.left + slot * i + slot / 2;
          const start = center - groupW / 2;

          return (
            <g key={month} className="group">
              <title>
                {`${monthText(month)}\n${series.map((item) => `${item.label}: ${format(item.values[i] ?? 0)}`).join("\n")}`}
              </title>
              <rect
                x={pad.left + slot * i}
                y={pad.top}
                width={slot}
                height={plotH}
                className="fill-transparent group-hover:fill-zinc-800/50"
              />
              {series.map((item, s) => {
                const value = item.values[i] ?? 0;
                const top = y(value);
                const h = y(0) - top;
                const x = start + s * (barW + gap);

                return h > 0 ? (
                  <path key={item.label} d={roundedTop(x, top, barW, h, Math.min(4, barW / 2, h))} fill={item.color} />
                ) : null;
              })}
              {i === peak && max > 0 && (
                <text x={center} y={Math.max(y(max) - 6, 10)} textAnchor="middle" className="fill-zinc-300 text-[14px]">
                  {format(max)}
                </text>
              )}
              <text x={center} y={height - 8} textAnchor="middle" className="fill-zinc-500 text-[14px]">
                {monthText(month, months.length > 12)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function monthText(month: string, short = false) {
  const [y, m] = month.split("-").map(Number);
  const name = shortMonthNames[m - 1];

  return short ? name : `${name} ${String(y).slice(2)}`;
}

function niceCeil(value: number) {
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value) ?? 10;

  return step * power;
}

// Bar with rounded top corners, square at the baseline.
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
