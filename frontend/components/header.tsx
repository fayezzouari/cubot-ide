import Link from 'next/link';
import { Github } from 'lucide-react';

export default function Header() {
  return (
    <header className="fixed top-0 w-full bg-background border-b-4 border-foreground z-50">
      <nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary border-2 border-foreground flex items-center justify-center">
            <span className="text-primary-foreground font-black text-lg">⚙</span>
          </div>
          <span className="font-serif text-2xl font-black text-foreground">CUBOT</span>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-12">
          <a href="#about" className="text-foreground font-black text-sm border-b-4 border-transparent hover:border-foreground transition-all">
            ABOUT
          </a>
          <a href="#features" className="text-foreground font-black text-sm border-b-4 border-transparent hover:border-foreground transition-all">
            FEATURES
          </a>
          <a href="#github" className="text-foreground font-black text-sm border-b-4 border-transparent hover:border-foreground transition-all">
            GITHUB
          </a>
        </div>

        {/* GitHub Link */}
        <Link
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-2 bg-primary border-2 border-foreground text-primary-foreground font-black text-sm"
        >
          <Github size={20} />
          <span className="hidden sm:inline">GITHUB</span>
        </Link>
      </nav>
    </header>
  );
}
