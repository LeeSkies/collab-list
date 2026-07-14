export class TrailingRefresh {
  readonly #refresh: () => Promise<unknown>
  readonly #delay: number
  #timer: ReturnType<typeof setTimeout> | undefined
  #running = false
  #pending = false
  #disposed = false

  constructor(refresh: () => Promise<unknown>, delay = 100) {
    this.#refresh = refresh
    this.#delay = delay
  }

  schedule(): void {
    if (this.#disposed) return
    this.#pending = true
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#start()
    }, this.#delay)
  }

  runNow(): void {
    if (this.#disposed) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#pending = true
    void this.#start()
  }

  dispose(): void {
    this.#disposed = true
    this.#pending = false
    clearTimeout(this.#timer)
    this.#timer = undefined
  }

  async #start(): Promise<void> {
    if (this.#disposed || !this.#pending) return
    if (this.#running) return

    this.#pending = false
    this.#running = true
    try {
      await this.#refresh()
    } catch {
      // Connectivity state and query error UI report refresh failures.
    } finally {
      this.#running = false
      if (this.#pending && !this.#disposed) void this.#start()
    }
  }
}
