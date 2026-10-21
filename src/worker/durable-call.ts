export async function durableCall<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Error) ||
        !("retryable" in error) || error.retryable !== true ||
        ("overloaded" in error && error.overloaded === true)
      ) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
