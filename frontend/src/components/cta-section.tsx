import { ArrowRight, Github, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CTASection() {
  return (
    <section id="github" className="py-24 px-6 bg-foreground text-primary-foreground border-t-8 border-secondary">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Zap size={28} className="text-primary-foreground" />
          <span className="text-lg font-black tracking-widest">READY TO BUILD?</span>
        </div>
        <h2 className="text-6xl md:text-7xl font-black mb-8 font-sans">
          START CODING <br /> YOUR ROBOTS
        </h2>
        <p className="text-lg mb-12 leading-relaxed max-w-2xl font-bold">
          Access the complete open-source CuBot platform on GitHub. Learn by coding real microcontroller projects and deploy to actual hardware when ready.
        </p>

        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <Button className="px-8 py-4 bg-primary-foreground border-4 border-primary-foreground text-foreground font-black text-base">
            LAUNCH EDITOR
            <ArrowRight size={20} className="ml-2" />
          </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 border-4 border-primary-foreground text-primary-foreground font-black text-base hover:bg-primary-foreground hover:text-foreground transition-all"
          >
            <span className="flex items-center gap-2">
              <Github size={20} />
              OPEN GITHUB
            </span>
          </a>
        </div>
      </div>
    </section>
  )
}
