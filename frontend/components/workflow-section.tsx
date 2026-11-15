import { ChevronRight } from 'lucide-react';
import ShotCrop from '@/components/shot-crop';

const steps = [
  {
    number: '01',
    title: 'Design',
    line: 'Describe a part and get a parametric assembly you can print.',
    chips: ['CAD Designer', 'STL'],
    tint: 'text-ws-cad',
    shot: { src: '/cad-demo.png', zoom: 2, x: 72, y: 60 },
  },
  {
    number: '02',
    title: 'Program',
    line: 'Write C++ or ROS nodes with AI help, or snap blocks together.',
    chips: ['Code IDE', 'Block Builder'],
    tint: 'text-ws-ide',
    shot: { src: '/jde-demo.png', zoom: 2.2, x: 30, y: 10 },
  },
  {
    number: '03',
    title: 'Simulate',
    line: 'Run firmware on a virtual board and programs in a 3D robot cell.',
    chips: ['ATmega328P', '3D cell'],
    tint: 'text-ws-blocks',
    shot: { src: '/block-demo.png', zoom: 2.4, x: 100, y: 14 },
  },
  {
    number: '04',
    title: 'Deploy',
    line: 'Flash a board from the browser, or drive a real fleet over VDA 5050.',
    chips: ['USB flash', 'MQTT'],
    tint: 'text-ws-fleet',
    shot: { src: '/fleet-demo.png', zoom: 1.8, x: 16, y: 50 },
  },
];

export default function WorkflowSection() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4 tracking-tight">
            From idea to hardware in four steps.
          </h2>
          <p className="text-base text-ink-2 leading-relaxed">
            One project carries you from the first sketch to a running robot.
          </p>
        </div>

        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {steps.map(({ number, title, line, chips, tint, shot }, i) => (
            <li key={number} className="relative">
              {i < steps.length - 1 && (
                <ChevronRight
                  size={18}
                  aria-hidden="true"
                  className="hidden lg:block absolute -right-[19px] top-[22%] text-line-strong"
                />
              )}

              <ShotCrop {...shot} className="aspect-[16/10] rounded-xl border border-line-strong mb-5" />

              <div className="flex items-baseline gap-3 mb-2">
                <span className={`text-3xl font-bold tracking-tight tabular-nums ${tint}`}>{number}</span>
                <h3 className="text-lg font-semibold text-ink">{title}</h3>
              </div>
              <p className="text-sm text-ink-2 leading-relaxed mb-4">{line}</p>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <span key={chip} className="text-xs text-ink-2 border border-line px-2 py-0.5 rounded-md">
                    {chip}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
