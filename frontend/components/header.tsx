import Link from 'next/link';
import { Github } from 'lucide-react';

export default function Header() {
  return (
    <header className="fixed top-0 w-full bg-background/95 backdrop-blur-sm border-b border-border z-50">
      <nav className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <span className="text-primary-foreground font-semibold text-base">⚙</span>
          </div>
          <span className="text-xl font-semibold text-foreground">Cubot</span>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-8">
          <a href="#about" className="text-foreground/80 hover:text-foreground font-medium text-sm transition-colors cursor-pointer">
            About
          </a>
          <a href="#features" className="text-foreground/80 hover:text-foreground font-medium text-sm transition-colors cursor-pointer">
            Features
          </a>
          <a href="#github" className="text-foreground/80 hover:text-foreground font-medium text-sm transition-colors cursor-pointer">
            GitHub
          </a>
        </div>

        {/* GitHub Link */}
        <Link
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded transition-colors"
        >
          <Github size={16} />
          <span className="hidden sm:inline">GitHub</span>
        </Link>
      </nav>
    </header>
  );
}
