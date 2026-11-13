// Vendored from tremorlabs/tremor; adapted for CoreOps. See frontend/licenses/tremor.txt.
/* eslint-disable @typescript-eslint/no-explicit-any */
// Tremor hasOnlyOneValueForKey [v0.1.0]

export function hasOnlyOneValueForKey(
  array: any[],
  keyToCheck: string,
): boolean {
  const val: any[] = [];

  for (const obj of array) {
    if (
      Object.prototype.hasOwnProperty.call(obj, keyToCheck) &&
      obj[keyToCheck] != null
    ) {
      val.push(obj[keyToCheck]);
      if (val.length > 1) {
        return false;
      }
    }
  }

  return true;
}
