import Job from '../../src/job.js'

export type ReportPayload = {
  reportId: number
}

export default class SendReport extends Job<ReportPayload> {
  static executed: ReportPayload[] = []

  ran: ReportPayload[] = []

  async run(payload: ReportPayload) {
    SendReport.executed.push(payload)
    this.ran.push(payload)
  }
}
