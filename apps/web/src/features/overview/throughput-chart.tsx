'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The exact-value table requires a keyboard-focusable scroll region. */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ThroughputPoint {
  readonly bucket: string;
  readonly failed: number;
  readonly succeeded: number;
}

const LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
});

export function ThroughputChart({
  points,
}: {
  readonly points: readonly ThroughputPoint[];
}): React.JSX.Element {
  const chartData = points.map((point) => ({
    ...point,
    label: LABEL_FORMATTER.format(new Date(point.bucket)),
  }));
  const totalSucceeded = points.reduce((sum, point) => sum + point.succeeded, 0);
  const totalFailed = points.reduce((sum, point) => sum + point.failed, 0);

  return (
    <div>
      <p className="qf-chart-summary" id="throughput-insight">
        {String(totalSucceeded)} requests succeeded and {String(totalFailed)} failed in the visible
        interval.
      </p>
      <div
        className="qf-throughput-chart"
        role="img"
        aria-describedby="throughput-insight"
        aria-label="Request outcomes over time"
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={chartData} margin={{ bottom: 4, left: -16, right: 4, top: 8 }}>
            <CartesianGrid stroke="var(--qf-rule)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--qf-muted)" />
            <YAxis allowDecimals={false} fontSize={11} stroke="var(--qf-muted)" />
            <Tooltip
              contentStyle={{
                background: 'var(--qf-surface)',
                border: '1px solid var(--qf-rule-strong)',
                borderRadius: '4px',
                color: 'var(--qf-foreground)',
              }}
            />
            <Legend />
            <Bar
              dataKey="succeeded"
              fill="var(--qf-success)"
              name="Succeeded"
              radius={[2, 2, 0, 0]}
            />
            <Bar dataKey="failed" fill="var(--qf-danger)" name="Failed" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="qf-chart-table">
        <h3>Exact throughput values</h3>
        <div
          className="qf-table-scroll"
          role="region"
          aria-label="Throughput values scroll area"
          tabIndex={0}
        >
          <table aria-label="Request throughput values">
            <thead>
              <tr>
                <th scope="col">Interval</th>
                <th scope="col">Succeeded</th>
                <th scope="col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((point) => (
                <tr key={point.bucket}>
                  <td>
                    <time dateTime={point.bucket}>{point.label}</time>
                  </td>
                  <td className="qf-mono">{point.succeeded}</td>
                  <td className="qf-mono">{point.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
