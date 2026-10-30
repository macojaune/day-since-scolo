export class TweetPublicationError extends Error {
  constructor(public readonly outcome: 'failed' | 'unknown', public readonly code: string) {
    super(code)
    this.name = 'TweetPublicationError'
  }
}
