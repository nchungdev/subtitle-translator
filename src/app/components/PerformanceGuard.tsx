"use client";

import { useEffect } from "react";

/**
 * PerformanceGuard patches window.performance.measure in development/Turbopack
 * environments to safely catch Next.js/React 19 hydration measure timing errors
 * (e.g. "Failed to execute 'measure' on 'Performance': 'RootNotFound' cannot have a negative time stamp").
 */
export default function PerformanceGuard() {
  useEffect(() => {
    if (typeof window !== "undefined" && typeof performance !== "undefined" && typeof performance.measure === "function") {
      const originalMeasure = performance.measure;
      performance.measure = function (measureName: string, startOrMeasureOptions?: string | PerformanceMeasureOptions, endMark?: string) {
        try {
          return (originalMeasure as (n: string, o?: string | PerformanceMeasureOptions, e?: string) => PerformanceMeasure).call(performance, measureName, startOrMeasureOptions, endMark);
        } catch {
          // Catch invalid Next.js / React DevTools hydration timing measurement glitches
          return undefined;
        }
      } as typeof performance.measure;
    }
  }, []);

  return null;
}
