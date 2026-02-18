import { Github, Mail, Cpu, Twitter } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-border py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
                <Cpu size={14} className="text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold text-foreground">Cubot</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              Learn embedded systems and robotics with AI assistance.
              Code on virtual hardware, then deploy to real microcontrollers.
            </p>
          </div>

          {/* Resources */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-4 tracking-wider uppercase">Resources</p>
            <ul className="space-y-2.5">
              {[
                { label: 'Platform', href: '#about' },
                { label: 'Features', href: '#features' },
                { label: 'Documentation', href: 'https://github.com' },
                { label: 'Get Started', href: '#github' },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-4 tracking-wider uppercase">Community</p>
            <div className="flex gap-2">
              {[
                { href: 'https://github.com', icon: Github, label: 'GitHub' },
                { href: 'https://twitter.com', icon: Twitter, label: 'Twitter' },
                { href: 'mailto:hello@cubot.dev', icon: Mail, label: 'Email' },
              ].map(({ href, icon: Icon, label }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  aria-label={label}
                  className="w-8 h-8 border border-border rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  <Icon size={14} />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground font-mono">
            © 2024 Cubot. Open source embedded systems education.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
