import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { T } from "../../lib/tokens";
import { format, seriesName, type ChartResult, type TimeWindow } from "./model";
export default function Chart({
  result,
  window: w,
  loading,
  onZoom,
}: {
  result?: ChartResult;
  window: TimeWindow;
  loading: boolean;
  onZoom: (from: number, to: number) => void;
}) {
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const data = useMemo(() => {
    // Fill only the expected time grid with null. Never bridge missing samples.
    const rows = new Map<number, Record<string, number | null>>();
    for (let t = w.from * 1000; t <= w.to * 1000; t += w.step * 1000)
      rows.set(t, { time: t });
    result?.data.series.forEach((s, i) =>
      s.points.forEach((p) => {
        const row = rows.get(p.time) || { time: p.time };
        row[`v${i}`] = p.value;
        rows.set(p.time, row);
      }),
    );
    return [...rows.values()].sort((a, b) => Number(a.time) - Number(b.time));
  }, [result, w]);
  const populated = result?.data.series.some((s) =>
    s.points.some((p) => p.value != null),
  );
  const colors = [T.accent, T.green, T.yellow, T.purple, T.red];
  return (
    <section
      className="obs-card obs-chart"
      aria-label={result?.metric.name || "Metric chart"}
    >
      <div className="obs-row">
        <h3>{result?.metric.name || "Loading metric…"}</h3>
        <small>
          {result?.metric.unit} {loading && "· Updating…"}
        </small>
      </div>
      {result?.error && (
        <p role="alert" className="obs-error">
          {result.error}
        </p>
      )}
      {result?.data.warnings?.map((v, i) => (
        <p className="obs-warning" key={i}>
          Partial response: {v}
        </p>
      ))}
      {!populated ? (
        <div className="obs-chart-empty">
          {loading
            ? "Loading samples…"
            : result?.error
              ? "Query failed"
              : "No finite samples in this interval"}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={data}
            margin={{ right: 12, left: 8, top: 12, bottom: 4 }}
            onMouseDown={(e) => {
              if (e?.activeLabel != null) {
                setStart(Number(e.activeLabel));
                setEnd(Number(e.activeLabel));
              }
            }}
            onMouseMove={(e) => {
              if (start != null && e?.activeLabel != null)
                setEnd(Number(e.activeLabel));
            }}
            onMouseUp={() => {
              if (
                start != null &&
                end != null &&
                Math.abs(start - end) >= w.step * 1000
              )
                onZoom(
                  Math.floor(Math.min(start, end) / 1000),
                  Math.floor(Math.max(start, end) / 1000),
                );
              setStart(null);
              setEnd(null);
            }}
          >
            <CartesianGrid stroke={T.border} vertical={false} />
            <XAxis
              type="number"
              dataKey="time"
              domain={[w.from * 1000, w.to * 1000]}
              scale="time"
              tickFormatter={(t) =>
                new Date(t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              stroke={T.textDim}
              tick={{ fontSize: 10 }}
              minTickGap={30}
            />
            <YAxis
              width={70}
              tickFormatter={(v) => format(v, result?.metric.unit)}
              stroke={T.textDim}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
              formatter={(v) =>
                format(typeof v === "number" ? v : null, result?.metric.unit)
              }
              contentStyle={{
                background: T.raised,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                color: T.text,
                fontSize: 11,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, maxHeight: 44, overflow: "auto" }}
            />
            {result?.data.series.map((s, i) => (
              <Line
                key={i}
                name={seriesName(s, i)}
                dataKey={`v${i}`}
                type="linear"
                stroke={colors[i % colors.length]}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                strokeWidth={1.7}
              />
            ))}
            {start != null && end != null && (
              <ReferenceArea
                x1={start}
                x2={end}
                fill={T.accent}
                fillOpacity={0.2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
      {result && (
        <details>
          <summary>
            Calculation · drag chart or use custom range to zoom
          </summary>
          <p>{result.metric.description}</p>
          <code>{result.metric.expression}</code>
        </details>
      )}
    </section>
  );
}
