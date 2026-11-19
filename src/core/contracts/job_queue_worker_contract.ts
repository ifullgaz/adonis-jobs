export abstract class JobQueueWorkerContract {
  abstract stop(): Promise<void>
  abstract start(timed: boolean): Promise<void>
}
