/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "Configure"
| instance and you can use codemods to modify the source files.
|
*/

import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@ifullgaz/adonis-jobs/provider')
    rcFile.addCommand('@ifullgaz/adonis-jobs/commands')
  })
  await codemods.makeUsingStub(stubsRoot, 'config.stub', {})
  await codemods.makeUsingStub(stubsRoot, 'migrations/job_queue.stub', {
    folder: 'database/migrations',
    fileName: `${new Date().getTime()}_create_job_queue_table.ts`,
  })
}
