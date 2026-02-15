import Link from 'next/link';
import { ArrowRight, Github, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CTASection() {
  return (
    <section id="github" className="py-24 px-6 bg-primary/5">
      <div className="max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 bg-primary/10 rounded-full">
          <Zap size={18} className="text-primary" />
          <span className="text-sm font-medium text-primary">Ready to build?</span>
        </div>
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          Start Coding Your Robots
        </h2>
        <p className="text-lg mb-10 leading-relaxed max-w-2xl mx-auto text-muted-foreground">
          Access the complete open-source Cubot platform on GitHub. Learn by coding real microcontroller projects and deploy to actual hardware when ready.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Button size="lg" className="px-8 h-12 font-medium text-base flex items-center gap-2">
            Launch Editor
            <ArrowRight size={18} />
          </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 h-12 border border-border text-foreground font-medium text-base hover:bg-muted rounded transition-colors cursor-pointer"
          >
            <Github size={18} />
            Open GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
