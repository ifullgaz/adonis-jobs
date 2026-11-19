import { type ApplicationService } from '@adonisjs/core/types'
import { type JobQueueServiceContract } from '../src/core/contracts/job_queue_service_contract.js'
import { type JobQueueWorkerContract } from '../src/core/contracts/job_queue_worker_contract.js'
import { type JobsRegistryContract } from '../src/core/contracts/jobs_registry_contract.js'
import { type JobQueueConfig } from '../src/types/types.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    jobsRegistry: JobsRegistryContract
    jobQueueService: JobQueueServiceContract
    jobQueueWorker: JobQueueWorkerContract
  }
}

export default class JobsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('jobsRegistry', async () => {
      const { default: JobsRegistry } = await import('../src/core/jobs_registry.ts')
      return new JobsRegistry(this.app)
    })
    this.app.container.singleton('jobQueueService', async () => {
      const { default: JobQueueService } = await import('../src/core/job_queue_service.js')
      const config = (await this.app.config.get('jobQueue')) as JobQueueConfig
      const bus = config.bus.factory ? await config.bus.factory() : undefined
      return new JobQueueService(config, bus)
    })
    if (this.app.getEnvironment() === 'console') {
      this.app.container.singleton('jobQueueWorker', async () => {
        const { default: JobQueueWorker } = await import('../src/core/job_queue_worker.js')
        return new JobQueueWorker(this.app)
      })
    }
  }
}
