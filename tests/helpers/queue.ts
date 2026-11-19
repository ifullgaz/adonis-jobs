import JobQueueEntry from '../../src/model/job_queue_entry.js'

export async function reloadJob(id: number) {
  const fresh = await JobQueueEntry.find(id)
  if (!fresh) {
    throw new Error('Scheduled job was not stored')
  }
  return fresh
}
