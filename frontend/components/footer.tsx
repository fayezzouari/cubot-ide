import Link from 'next/link';
import { Github, Mail, Cpu, Twitter } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-muted/30 border-t border-border py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
                <Cpu size={16} className="text-primary-foreground" />
              </div>
              <span className="text-xl font-semibold text-foreground">Cubot</span>
            </div>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Learn embedded systems and robotics with AI assistance. Code on virtual hardware, then deploy to real microcontrollers.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Resources</h3>
            <ul className="space-y-2">
              <li>
                <a href="#about" className="text-muted-foreground hover:text-foreground transition-colors text-sm cursor-pointer">
                  About Platform
                </a>
              </li>
              <li>
                <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors text-sm cursor-pointer">
                  Features
                </a>
              </li>
              <li>
                <a href="#github" className="text-muted-foreground hover:text-foreground transition-colors text-sm cursor-pointer">
                  Get Started
                </a>
              </li>
              <li>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors text-sm cursor-pointer">
                  Documentation
                </a>
              </li>
            </ul>
          </div>

          {/* Social Links */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Community</h3>
            <div className="flex gap-3">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-background border border-border rounded hover:bg-muted hover:border-primary/50 transition-colors flex items-center justify-center cursor-pointer"
              >
                <Github size={18} />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-background border border-border rounded hover:bg-muted hover:border-primary/50 transition-colors flex items-center justify-center cursor-pointer"
              >
                <Twitter size={18} />
              </a>
              <a
                href="mailto:hello@cubot.dev"
                className="w-10 h-10 bg-background border border-border rounded hover:bg-muted hover:border-primary/50 transition-colors flex items-center justify-center cursor-pointer"
              >
                <Mail size={18} />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-border pt-6 text-center text-muted-foreground text-sm">
          <p>© 2024 Cubot. Making embedded systems education accessible.</p>
        </div>
      </div>
    </footer>
  );
}
