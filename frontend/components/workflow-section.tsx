'use client';

const steps = [
  {
    number: '01',
    title: 'Write',
    subtitle: 'Code or click — your choice',
    description: 'Write embedded C/C++ in the full IDE with AI suggestions, or drag-and-drop visual blocks to program robot behaviors. No setup, no installs.',
    tags: ['Monaco Editor', 'AI Chat', 'Block Builder'],
  },
  {
    number: '02',
    title: 'Compile',
    subtitle: 'Target any microcontroller',
    description: 'One-click compilation via Docker-containerized toolchains. Get real-time build logs, AI-explained error messages, and ready-to-flash binaries.',
    tags: ['Arduino', 'ESP32', 'TI ARM'],
  },
  {
    number: '03',
    title: 'Simulate',
    subtitle: 'Test without hardware',
    description: 'Run your compiled code on a virtual microcontroller. Monitor GPIO states, ADC readings, UART output, and timing — all in real-time.',
    tags: ['ATmega328P', 'Serial Monitor', 'GPIO Sim'],
  },
  {
    number: '04',
    title: 'Deploy',
    subtitle: 'Ship to real hardware',
    description: 'Flash your HEX file directly to a connected Arduino board from the browser. Or export and use any standard programmer — the choice is yours.',
    tags: ['HEX Export', 'OTA Upload', 'Serial Flash'],
  },
];

export default function WorkflowSection() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">

        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            From idea to hardware<br />in four steps.
          </h2>
          <p className="text-ink-3 text-sm max-w-md leading-relaxed">
            A complete loop that takes you from writing the first line of code
            to running firmware on a real microcontroller.
          </p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connector line */}
          <div className="absolute left-[19px] top-6 bottom-6 w-px bg-line hidden md:block" style={{ left: '2.25rem' }} />

          <div className="space-y-3">
            {steps.map(({ number, title, subtitle, description, tags }) => (
              <div
                key={number}
                className="group grid md:grid-cols-[auto_1fr_auto] gap-6 items-start p-6 rounded-xl border border-line bg-surface hover:bg-raised hover:border-line-strong transition-all"
              >
                {/* Step number */}
                <div className="w-9 h-9 rounded-lg border border-line bg-surface flex items-center justify-center flex-shrink-0 relative z-10">
                  <span className="text-xs text-ink-3 group-hover:text-ink-2 transition-colors">{number}</span>
                </div>

                {/* Content */}
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <h3 className="text-sm font-semibold text-ink">{title}</h3>
                    <span className="text-xs text-ink-3">{subtitle}</span>
                  </div>
                  <p className="text-xs text-ink-3 leading-relaxed max-w-lg">{description}</p>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-ink-3 border border-line px-2 py-0.5 rounded-lg whitespace-nowrap"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
