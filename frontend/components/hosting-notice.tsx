import { PlayCircle } from 'lucide-react';

const DEMO_URL = 'https://lnkd.in/p/eVDMFRsW';

export default function HostingNotice() {
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-sm leading-relaxed text-white/70"
    >
      <p className="mb-3">
        Hi, thanks for stopping by. I&apos;m running CuBot on my own, and keeping
        the backend online costs more than I can cover right now, so I&apos;ve paused
        it for the moment. Sorry about that.
      </p>
      <p className="mb-4">
        If you&apos;d still like to see what it does, I recorded a short demo.
      </p>
      <a
        href={DEMO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-white transition hover:bg-white/[0.08]"
      >
        <PlayCircle size={14} />
        Watch the demo
      </a>
    </div>
  );
}
