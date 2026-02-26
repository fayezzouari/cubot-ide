import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function CTASection() {
  return (
    <section id="github" className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-3xl mx-auto">

        {/* Main CTA box */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center relative overflow-hidden">
          {/* Subtle glow */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.06), transparent 70%)' }} />

          <p className="text-xs font-mono text-white/25 mb-5 tracking-widest uppercase relative z-10">Get started</p>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-5 tracking-tight leading-tight relative z-10">
            Build something real.<br />No hardware required.
          </h2>
          <p className="text-sm text-white/35 mb-10 leading-relaxed max-w-md mx-auto relative z-10">
            CuBot is free and open-source. Open your browser, start a project, and
            go from code to virtual hardware in under a minute.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center relative z-10">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 text-black font-medium text-sm rounded-xl transition-all"
            >
              Start Building Free
              <ArrowRight size={14} />
            </Link>
            <a
              href="https://github.com/fayezzouari/cubot-ide"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/50 hover:text-white font-medium text-sm rounded-xl transition-all"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Star on GitHub
            </a>
          </div>
        </div>

        {/* Mini proof strip */}
        <div className="flex items-center justify-center gap-8 mt-10">
          {[
            'No credit card',
            'No installation',
            'Open source',
          ].map((item, i) => (
            <span key={i} className="text-xs text-white/20 font-mono">{item}</span>
          ))}
        </div>

      </div>
    </section>
  );
}
