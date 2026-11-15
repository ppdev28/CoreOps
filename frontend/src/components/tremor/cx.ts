// Vendored from tremorlabs/tremor; adapted for CoreOps. See frontend/licenses/tremor.txt.
// Tremor cx [v0.0.0]

import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...args: ClassValue[]) {
  return twMerge(clsx(...args));
}
