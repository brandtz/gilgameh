import { getDb, closeDb } from './index'

async function main() {
  await getDb()
  console.log(JSON.stringify({ level: 'info', msg: 'Database schema verified/migrated successfully' }))
  await closeDb()
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Migration failed', error: String(err) }))
  process.exit(1)
})
