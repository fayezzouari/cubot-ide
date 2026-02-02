import Link from 'next/link';
import { Github, Mail, Cpu, Twitter } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-background border-t-8 border-foreground py-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-16 mb-16">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-foreground border-4 border-foreground flex items-center justify-center">
                <Cpu size={20} className="text-background" />
              </div>
              <span className="font-sans text-2xl font-black text-foreground">CUBOT</span>
            </div>
            <p className="text-foreground font-bold leading-relaxed">
              Learn embedded systems and robotics with AI assistance. Code on virtual hardware, then deploy to real microcontrollers.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-sans font-black text-foreground mb-6 text-lg">RESOURCES</h3>
            <ul className="space-y-3">
              <li>
                <a href="#about" className="text-foreground hover:border-b-4 hover:border-foreground transition-all font-bold text-sm">
                  ABOUT PLATFORM
                </a>
              </li>
              <li>
                <a href="#features" className="text-foreground hover:border-b-4 hover:border-foreground transition-all font-bold text-sm">
                  FEATURES
                </a>
              </li>
              <li>
                <a href="#github" className="text-foreground hover:border-b-4 hover:border-foreground transition-all font-bold text-sm">
                  GET STARTED
                </a>
              </li>
              <li>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-foreground hover:border-b-4 hover:border-foreground transition-all font-bold text-sm">
                  DOCS
                </a>
              </li>
            </ul>
          </div>

          {/* Social Links */}
          <div>
            <h3 className="font-sans font-black text-foreground mb-6 text-lg">COMMUNITY</h3>
            <div className="flex gap-4">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 bg-foreground text-background hover:opacity-80 transition-opacity flex items-center justify-center border-2 border-foreground"
              >
                <Github size={20} />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 bg-foreground text-background hover:opacity-80 transition-opacity flex items-center justify-center border-2 border-foreground"
              >
                <Twitter size={20} />
              </a>
              <a
                href="mailto:hello@cubot.dev"
                className="w-12 h-12 bg-foreground text-background hover:opacity-80 transition-opacity flex items-center justify-center border-2 border-foreground"
              >
                <Mail size={20} />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t-8 border-foreground pt-8 text-center text-foreground font-bold">
          <p>© 2024 CUBOT. MAKING EMBEDDED SYSTEMS EDUCATION ACCESSIBLE.</p>
        </div>
      </div>
    </footer>
  );
}
