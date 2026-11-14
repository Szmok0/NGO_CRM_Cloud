// npm run dev: serwer (tsx watch, port 3001) i klient (Vite, port 5173, /api przekierowane na serwer).
import { spawn } from 'node:child_process'

const procs = ['dev:server', 'dev:client'].map((script) =>
  spawn('npm', ['run', script], { stdio: 'inherit', shell: true })
)

const stop = () => {
  for (const p of procs) p.kill()
  process.exit()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => code && stop())
