export class KeyedSerialExecutor {
  readonly #tails = new Map<string, Promise<void>>()

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key)
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#tails.set(key, current)
    if (previous) await previous

    try {
      return await operation()
    } finally {
      release()
      if (this.#tails.get(key) === current) this.#tails.delete(key)
    }
  }
}
