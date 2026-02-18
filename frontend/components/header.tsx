import Link from 'next/link';
import { Github, Cpu } from 'lucide-react';

export default function Header() {
  return (
    <header className="fixed top-0 w-full z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
            <Cpu size={14} className="text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">Cubot</span>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-7">
          <a href="#about" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            Platform
          </a>
          <a href="#features" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            Features
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>

        {/* CTA */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs rounded-md transition-colors"
        >
          <Github size={13} />
          Launch Editor
        </Link>
      </nav>
    </header>
  );
}
