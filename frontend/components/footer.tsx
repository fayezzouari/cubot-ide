import { Github, Mail, Cpu, Twitter } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 bg-white rounded-md flex items-center justify-center">
                <Cpu size={14} className="text-black" />
              </div>
              <span className="text-sm font-semibold text-white">cubot</span>
            </div>
            <p className="text-xs text-white/30 leading-relaxed max-w-xs">
              Learn embedded systems and robotics with AI assistance.
              Code on virtual hardware, then deploy to real microcontrollers.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-white/40 mb-4 tracking-wider uppercase">Resources</p>
            <ul className="space-y-2.5">
              {[
                { label: 'Platform', href: '#about' },
                { label: 'Features', href: '#features' },
                { label: 'Documentation', href: 'https://github.com' },
                { label: 'Get Started', href: '#github' },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-xs text-white/25 hover:text-white/60 transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-white/40 mb-4 tracking-wider uppercase">Community</p>
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
                  className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/20 transition-colors"
                >
                  <Icon size={13} />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.04] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/20 font-mono">
            © 2024 Cubot. Open source embedded systems education.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Privacy</a>
            <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
