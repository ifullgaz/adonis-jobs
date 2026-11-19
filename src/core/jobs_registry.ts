import { basename, extname } from 'node:path'
import { type ApplicationService } from '@adonisjs/core/types'
import logger from '@adonisjs/core/services/logger'
import { fsReadAll } from '@adonisjs/core/helpers'
import Job from '../job.ts'
import { type JobType } from '../types/types.ts'
import { type JobsRegistryContract } from './contracts/jobs_registry_contract.ts'

export default class JobsRegistry implements JobsRegistryContract {
  constructor(protected app: ApplicationService) {}

  private jobs: Record<string, JobType> = {}

  private loaded: boolean = false

  private async loadJobs(): Promise<undefined> {
    if (this.loaded) {
      return
    }
    this.loaded = true
    const jobsFiles = await fsReadAll(this.app.relativePath('app/jobs'), {
      pathType: 'url',
      ignoreMissingRoot: true,
      filter: (filePath: string) => {
        const ext = extname(filePath)
        return (
          !basename(filePath).startsWith('_') &&
          !filePath.endsWith('.d.ts') &&
          (ext === '.js' || (ext === '.ts' && !filePath.endsWith('.d.ts')))
        )
      },
    })
    for (let file of jobsFiles) {
      const module = await import(file)
      if (!(module.default.prototype instanceof Job)) {
        throw new Error(`${file} does not export a Job`)
      }
      const jobClass = module.default as JobType
      this.jobs[jobClass.name] = jobClass
      logger.trace(`Loaded Job: ${jobClass.name}`)
    }
  }

  public async getJobs(): Promise<Record<string, JobType>> {
    await this.loadJobs()
    return this.jobs
  }

  public async getJob(name: string): Promise<JobType | undefined> {
    await this.loadJobs()
    return this.jobs[name]
  }

  public async hasJob(name: string): Promise<boolean> {
    await this.loadJobs()
    return this.jobs[name] !== undefined
  }

  public async registerJob(job: JobType): Promise<void> {
    await this.loadJobs()
    const name = job.name
    if (this.jobs[name]) {
      logger.trace(`Job ${name} already registered, skipping registration`)
      return
    }
    this.jobs[name] = job
    logger.trace(`Registered Job: ${name}`)
  }
}
