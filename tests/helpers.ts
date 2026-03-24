/**
 * Safe indexed access for tests. Throws if the value is undefined.
 */
export function at<T>(arr: T[] | undefined, index: number): T {
  if (!arr || index >= arr.length) {
    throw new Error(
      `Index ${index} out of bounds (length: ${arr?.length ?? 0})`,
    );
  }
  return arr[index] as T;
}
