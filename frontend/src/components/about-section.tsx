import { Code2, Boxes, Cpu, Zap, Radio, RotateCcw } from 'lucide-react'

export default function AboutSection() {
  const roboticFeatures = [
    { icon: Cpu, label: 'MCU Support', desc: 'ARM, ESP32, STM32' },
    { icon: Zap, label: 'Real-time I/O', desc: 'GPIO, ADC, PWM' },
    { icon: Radio, label: 'Wireless', desc: 'BLE, WiFi, LoRaWAN' },
    { icon: RotateCcw, label: 'Simulation', desc: 'Real-time execution' },
  ]

  return (
    <section id="about" className="py-24 px-6 bg-background border-t-8 border-foreground">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-6xl md:text-7xl font-black text-foreground mb-4 font-sans">
          TWO PATHS
        </h2>
        <p className="text-lg font-bold text-foreground mb-16 border-l-8 border-foreground pl-6">
          CHOOSE YOUR LEARNING STYLE
        </p>

        <div className="grid md:grid-cols-2 gap-8 mb-20">
          {/* Code-Based Editor */}
          <div className="p-8 border-4 border-foreground bg-background">
            <div className="flex items-start gap-4 mb-8 pb-8 border-b-4 border-foreground">
              <div className="w-16 h-16 bg-foreground border-4 border-foreground flex items-center justify-center flex-shrink-0">
                <Code2 size={32} className="text-background" />
              </div>
              <div>
                <h3 className="text-3xl font-black text-foreground font-sans">CODE EDITOR</h3>
                <p className="text-sm font-bold text-foreground mt-2">Professional Development</p>
              </div>
            </div>
            <p className="text-foreground leading-relaxed mb-6 font-bold">
              Write embedded C/C++ with full IDE features, AI autocompletion, and cross-platform compilation for multiple microcontrollers.
            </p>
            <ul className="space-y-3 text-sm font-bold text-foreground">
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Full IDE with debugging
              </li>
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Cross-compiler support
              </li>
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Real hardware deployment
              </li>
            </ul>
          </div>

          {/* No-Code Solution */}
          <div className="p-8 border-4 border-foreground bg-background">
            <div className="flex items-start gap-4 mb-8 pb-8 border-b-4 border-foreground">
              <div className="w-16 h-16 bg-foreground border-4 border-foreground flex items-center justify-center flex-shrink-0">
                <Boxes size={32} className="text-background" />
              </div>
              <div>
                <h3 className="text-3xl font-black text-foreground font-sans">BLOCK BUILDER</h3>
                <p className="text-sm font-bold text-foreground mt-2">Visual Programming</p>
              </div>
            </div>
            <p className="text-foreground leading-relaxed mb-6 font-bold">
              Drag-and-drop blocks to control motors, sensors, and actuators. Perfect for beginners and robotics competitions.
            </p>
            <ul className="space-y-3 text-sm font-bold text-foreground">
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Drag-and-drop interface
              </li>
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Live sensor feedback
              </li>
              <li className="flex items-center gap-3">
                <span className="w-3 h-3 bg-foreground" />
                Instant compilation
              </li>
            </ul>
          </div>
        </div>

        {/* Supported Robotics Features */}
        <div className="border-t-8 border-foreground pt-12 mb-20">
          <h3 className="text-5xl font-black text-foreground mb-12 font-sans">
            EMBEDDED FEATURES
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {roboticFeatures.map((feature, i) => {
              const Icon = feature.icon
              return (
                <div
                  key={i}
                  className="p-6 bg-background border-4 border-foreground text-center"
                >
                  <Icon size={36} className="text-foreground mx-auto mb-4" />
                  <p className="font-black text-foreground text-sm mb-2">{feature.label}</p>
                  <p className="text-xs font-bold text-foreground">{feature.desc}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Virtual Hardware Grid */}
        <div className="border-t-8 border-foreground pt-12">
          <h3 className="text-5xl font-black text-foreground mb-12 font-sans">
            SUPPORTED MICROCONTROLLERS
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'ARM CORTEX-M4', chip: 'STM32F4' },
              { name: 'ESP32', chip: 'Xtensa' },
              { name: 'STM32L476', chip: 'Cortex-M4' },
              { name: 'ARDUINO NANO', chip: 'ATmega328P' },
            ].map((mcu, i) => (
              <div
                key={i}
                className="p-6 bg-background border-4 border-foreground text-center"
              >
                <Cpu size={36} className="text-foreground mx-auto mb-4" />
                <p className="font-black text-foreground text-sm mb-1">{mcu.name}</p>
                <p className="text-xs font-bold text-foreground">{mcu.chip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
