// Vendored from tremorlabs/tremor; adapted for CoreOps. See frontend/licenses/tremor.txt.
// Tremor Spark Chart [v1.0.0]
/* eslint-disable @typescript-eslint/no-explicit-any */

"use client";

import React from "react";
import {
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { AxisDomain } from "recharts/types/util/types";

import {
  AvailableChartColors,
  type AvailableChartColorsKeys,
  constructCategoryColors,
  getColorClassName,
} from "./chartColors";
import { cx } from "./cx";
import { getYAxisDomain } from "./getYAxisDomain";

//#region SparkLineChart

interface SparkLineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  categories: string[];
  index: string;
  colors?: AvailableChartColorsKeys[];
  autoMinValue?: boolean;
  minValue?: number;
  maxValue?: number;
  connectNulls?: boolean;
}

const SparkLineChart = React.forwardRef<HTMLDivElement, SparkLineChartProps>(
  (props, forwardedRef) => {
    const {
      data = [],
      categories = [],
      index,
      colors = AvailableChartColors,
      autoMinValue = false,
      minValue,
      maxValue,
      connectNulls = false,
      className,
      ...other
    } = props;

    const categoryColors = constructCategoryColors(categories, colors);
    const yAxisDomain = getYAxisDomain(autoMinValue, minValue, maxValue);

    return (
      <div
        ref={forwardedRef}
        className={cx("h-12 w-28", className)}
        tremor-id="tremor-raw"
        {...other}
      >
        <ResponsiveContainer>
          <RechartsLineChart
            data={data}
            margin={{
              bottom: 1,
              left: 1,
              right: 1,
              top: 1,
            }}
          >
            <XAxis hide dataKey={index} />
            <YAxis hide={true} domain={yAxisDomain as AxisDomain} />
            {categories.map((category) => (
              <Line
                className={cx(
                  getColorClassName(
                    categoryColors.get(category) as AvailableChartColorsKeys,
                    "stroke",
                  ),
                )}
                dot={false}
                strokeOpacity={1}
                key={category}
                name={category}
                type="linear"
                dataKey={category}
                stroke=""
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                isAnimationActive={false}
                connectNulls={connectNulls}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    );
  },
);

SparkLineChart.displayName = "SparkLineChart";

export { SparkLineChart };
