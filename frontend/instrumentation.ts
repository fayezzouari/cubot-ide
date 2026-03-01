export async function register() {
  // Only run in the Node.js runtime (not Edge), and only when the agent is configured
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DD_AGENT_HOST) {
    try {
      const tracer = (await import('dd-trace')).default
      tracer.init({
        service: 'cubot-frontend',
        env: process.env.DD_ENV ?? process.env.NODE_ENV,
        logInjection: true,
      })
    } catch (e) {
      // dd-trace native modules may be absent in standalone builds — non-fatal
      console.warn('[dd-trace] Skipping frontend tracing:', (e as Error).message)
    }
  }
}
