export async function register() {
  // Only run in the Node.js runtime (not Edge), and only when the agent is configured
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DD_AGENT_HOST) {
    const tracer = (await import('dd-trace')).default
    tracer.init({
      service: 'cubot-frontend',
      env: process.env.DD_ENV ?? process.env.NODE_ENV,
      logInjection: true,
    })
  }
}
