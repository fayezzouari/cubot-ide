import Link from 'next/link';
import { ArrowRight, Github } from 'lucide-react';

export default function CTASection() {
  return (
    <section id="github" className="py-24 px-6 border-t border-border">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-xs font-mono text-primary mb-4 tracking-widest uppercase">Get started</p>
        <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-5 tracking-tight leading-tight">
          Start building<br />your next robot
        </h2>
        <p className="text-sm text-muted-foreground mb-10 leading-relaxed max-w-lg mx-auto">
          Cubot is free and open-source. Start writing embedded code in your browser —
          no hardware, no setup, no waiting.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-md transition-all hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
          >
            Launch Editor
            <ArrowRight size={15} />
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-border hover:border-foreground/30 text-foreground font-medium text-sm rounded-md transition-colors"
          >
            <Github size={15} />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
