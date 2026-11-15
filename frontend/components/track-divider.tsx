export default function TrackDivider({ delay = 0 }: { delay?: number }) {
  return (
    <div className="relative h-20 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      <div className="track-runner absolute left-0 top-1/2 w-full" style={{ animationDelay: `${delay}s` }}>
        <div className="absolute right-full top-0 flex items-center -translate-y-1/2">
          <span className="block h-px w-72 bg-gradient-to-r from-transparent to-ink-2" />
          <svg width="68" height="44" viewBox="0 0 52 34" fill="none" className="-ml-px">
            <rect x="9" y="1" width="16" height="6" rx="2" fill="#1E1E1E" stroke="#404040" />
            <rect x="9" y="27" width="16" height="6" rx="2" fill="#1E1E1E" stroke="#404040" />
            <rect x="3" y="6" width="34" height="22" rx="4" fill="#161616" stroke="#878787" />
            <rect x="9" y="11" width="16" height="12" rx="2" fill="#1B1E21" stroke="#93A4B5" />
            <path d="M12 15h10M12 19h6" stroke="#93A4B5" strokeLinecap="round" />
            <circle cx="31" cy="17" r="2" fill="#0E0E0E" stroke="#404040" />
            <path d="M37 12h6M37 22h6" stroke="#404040" />
            <rect x="42" y="9" width="6" height="6" rx="1.5" fill="#23211D" stroke="#B5A78C" />
            <rect x="42" y="19" width="6" height="6" rx="1.5" fill="#23211D" stroke="#B5A78C" />
          </svg>
        </div>
      </div>
    </div>
  );
}
