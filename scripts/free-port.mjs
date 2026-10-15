// Frees a TCP port before `next dev` binds it, so a stale server from a previous
// run doesn't cause EADDRINUSE. Cross-platform (Windows/macOS/Linux) and always
// exits 0 — "nothing was listening" is success, not an error. Run as `npm run
// dev`'s predev hook: `node scripts/free-port.mjs 6175`.
import { execSync } from 'node:child_process'

const port = process.argv[2] || '6175'

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return '' // no matches / tool missing: treat as "port already free"
  }
}

const pids = new Set()

if (process.platform === 'win32') {
  // netstat columns: Proto  Local Address  Foreign Address  State  PID
  for (const line of run('netstat -ano -p tcp').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
      pids.add(parts[parts.length - 1])
    }
  }
  for (const pid of pids) {
    if (pid && pid !== '0') run(`taskkill /PID ${pid} /F /T`)
  }
} else {
  for (const pid of run(`lsof -ti tcp:${port}`).split(/\s+/)) {
    if (pid) {
      pids.add(pid)
      run(`kill -9 ${pid}`)
    }
  }
}

if (pids.size > 0) {
  console.log(`Freed port ${port} (stopped ${pids.size} process${pids.size > 1 ? 'es' : ''}).`)
}
