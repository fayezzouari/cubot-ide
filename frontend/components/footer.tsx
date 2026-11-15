import { Github, Mail, Linkedin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-line pt-12 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <img src="/cubot.svg" alt="CuBot" className="w-7 h-7 object-contain" />
              <span className="text-sm font-semibold text-ink">CuBot</span>
            </div>
            <p className="text-xs text-ink-3 leading-relaxed max-w-xs">
              AI-powered embedded IDE with a code editor, visual block builder,
              and CAD designer — all in one browser. No hardware required.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-3 mb-4">Product</p>
            <ul className="space-y-2.5">
              {[
                { label: 'Platform', href: '#about' },
                { label: 'Features', href: '#features' },
                { label: 'Workflow', href: '#' },
                { label: 'Get Started', href: '#github' },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-xs text-ink-3 hover:text-ink-2 transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-3 mb-4">Community</p>
            <div className="flex gap-2">
              {[
                { href: 'https://github.com/fayezzouari', icon: Github, label: 'GitHub' },
                { href: 'mailto:fayez.zouari@insat.ucar.tn', icon: Mail, label: 'Email' },
                { href: 'https://linkedin.com/in/fayez-zouari', icon: Linkedin, label: 'LinkedIn' },  
              ].map(({ href, icon: Icon, label }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  aria-label={label}
                  className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-ink-3 hover:text-ink-2 hover:border-line-strong transition-colors"
                >
                  <Icon size={13} />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-line pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-ink-3">
            © 2026 CuBot. Open source embedded systems platform.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="text-xs text-ink-3 hover:text-ink transition-colors">Privacy</a>
            <a href="#" className="text-xs text-ink-3 hover:text-ink transition-colors">Terms</a>
          </div>
        </div>
      </div>

      <div
        className="max-w-6xl mx-auto mt-10 overflow-hidden"
        style={{ fontSize: 'min(27vw, 362px)', height: '0.72em' }}
        aria-hidden="true"
      >
        <span
          className="block font-bold text-center whitespace-nowrap tracking-[0.02em] bg-gradient-to-b from-ink from-10% to-line bg-clip-text text-transparent select-none"
          style={{ lineHeight: 0.86 }}
        >
          CuBot
        </span>
      </div>
    </footer>
  );
}
