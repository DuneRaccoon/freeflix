// Enhanced SVG Animation Components with better transitions

export const PopcornAnimation: React.FC = () => (
  <div className="w-32 h-32 relative transition-transform duration-500">
    <svg viewBox="0 0 100 100" className="w-full h-full filter drop-shadow-lg">
      {/* Popcorn Bucket */}
      <rect x="25" y="40" width="50" height="40" rx="5" fill="#e53e3e" stroke="#742a2a" strokeWidth="2" className="transition-all duration-700" />
      <rect x="20" y="50" width="60" height="30" rx="5" fill="#e53e3e" stroke="#742a2a" strokeWidth="2" className="transition-all duration-700" />
      <rect x="22" y="40" width="56" height="10" fill="#f6e05e" stroke="#744210" strokeWidth="1" className="transition-all duration-700" />
      
      {/* Popcorn */}
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "1.8s", animationDelay: "0.1s" }} cx="40" cy="30" r="8" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "2.2s", animationDelay: "0.3s" }} cx="55" cy="25" r="7" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "1.9s", animationDelay: "0.5s" }} cx="65" cy="35" r="6" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "2.4s", animationDelay: "0.7s" }} cx="45" cy="40" r="5" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "2.0s", animationDelay: "0.2s" }} cx="35" cy="35" r="7" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "2.3s", animationDelay: "0.4s" }} cx="50" cy="30" r="6" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      <circle className="animate-bounce transition-transform" style={{ animationDuration: "1.7s", animationDelay: "0.6s" }} cx="60" cy="40" r="5" fill="#f6e05e" stroke="#744210" strokeWidth="1" />
      
      {/* Steam/Popping Effect */}
      <path className="animate-ping transition-opacity" style={{ animationDuration: "3s", opacity: "0.3" }} d="M30,20 Q35,10 40,20" stroke="#f6e05e" strokeWidth="2" fill="transparent" />
      <path className="animate-ping transition-opacity" style={{ animationDuration: "3.5s", animationDelay: "0.3s", opacity: "0.3" }} d="M50,15 Q55,5 60,15" stroke="#f6e05e" strokeWidth="2" fill="transparent" />
      <path className="animate-ping transition-opacity" style={{ animationDuration: "2.8s", animationDelay: "0.6s", opacity: "0.3" }} d="M65,20 Q70,10 75,20" stroke="#f6e05e" strokeWidth="2" fill="transparent" />
    </svg>
  </div>
);

export const TicketsAnimation: React.FC = () => (
  <div className="w-32 h-32 relative transition-transform duration-500">
    <svg viewBox="0 0 100 100" className="w-full h-full filter drop-shadow-lg">
      {/* Ticket 1 */}
      <g className="animate-pulse transition-all" style={{ animationDuration: "2s", transformOrigin: "center" }}>
        <rect x="20" y="30" width="60" height="25" rx="5" fill="#4299e1" stroke="#2b6cb0" strokeWidth="2" />
        <line x1="70" y1="30" x2="70" y2="55" stroke="#2b6cb0" strokeWidth="2" strokeDasharray="4" />
        <circle cx="70" cy="42.5" r="5" fill="#ebf8ff" stroke="#2b6cb0" strokeWidth="1" />
        <rect x="25" y="37" width="25" height="3" rx="1" fill="#ebf8ff" />
        <rect x="25" y="43" width="35" height="3" rx="1" fill="#ebf8ff" />
        <rect x="25" y="49" width="15" height="3" rx="1" fill="#ebf8ff" />
      </g>
      
      {/* Ticket 2 (shifted slightly) */}
      <g className="animate-pulse transition-all" style={{ animationDuration: "2.5s", animationDelay: "0.5s", transformOrigin: "center" }}>
        <rect x="25" y="45" width="60" height="25" rx="5" fill="#f687b3" stroke="#b83280" strokeWidth="2" />
        <line x1="75" y1="45" x2="75" y2="70" stroke="#b83280" strokeWidth="2" strokeDasharray="4" />
        <circle cx="75" cy="57.5" r="5" fill="#fff5f7" stroke="#b83280" strokeWidth="1" />
        <rect x="30" y="52" width="25" height="3" rx="1" fill="#fff5f7" />
        <rect x="30" y="58" width="35" height="3" rx="1" fill="#fff5f7" />
        <rect x="30" y="64" width="15" height="3" rx="1" fill="#fff5f7" />
      </g>
      
      {/* Floating Effect */}
      <animateTransform 
        attributeName="transform"
        type="translate"
        values="0,0; 0,-5; 0,0"
        dur="3s"
        repeatCount="indefinite"
        additive="sum"
      />
    </svg>
  </div>
);

export const TheaterSeatsAnimation: React.FC = () => (
  <div className="w-48 h-32 relative transition-transform duration-500">
    <svg viewBox="0 0 120 80" className="w-full h-full filter drop-shadow-lg">
      {/* Row 1 */}
      <g className="animate-pulse transition-all" style={{ animationDuration: "1.8s", transformOrigin: "center" }}>
        <rect x="10" y="10" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="30" y="10" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="50" y="10" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="70" y="10" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="90" y="10" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
      </g>
      
      {/* Row 2 - Highlighted seats */}
      <g className="animate-pulse transition-all" style={{ animationDuration: "2s", animationDelay: "0.3s", transformOrigin: "center" }}>
        <rect x="10" y="30" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1">
          <animate attributeName="fill" values="#4a5568;#4a5568" dur="0.5s" begin="0s" repeatCount="1" />
        </rect>
        <rect x="30" y="30" width="15" height="15" rx="3" fill="#f56565" stroke="#822727" strokeWidth="1">
          <animate attributeName="fill" values="#4a5568;#f56565" dur="0.5s" begin="0.5s" repeatCount="1" />
        </rect>
        <rect x="50" y="30" width="15" height="15" rx="3" fill="#f56565" stroke="#822727" strokeWidth="1">
          <animate attributeName="fill" values="#4a5568;#f56565" dur="0.5s" begin="1s" repeatCount="1" />
        </rect>
        <rect x="70" y="30" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1">
          <animate attributeName="fill" values="#4a5568;#4a5568" dur="0.5s" begin="0s" repeatCount="1" />
        </rect>
        <rect x="90" y="30" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1">
          <animate attributeName="fill" values="#4a5568;#4a5568" dur="0.5s" begin="0s" repeatCount="1" />
        </rect>
      </g>
      
      {/* Row 3 */}
      <g className="animate-pulse transition-all" style={{ animationDuration: "1.5s", animationDelay: "0.6s", transformOrigin: "center" }}>
        <rect x="10" y="50" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="30" y="50" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="50" y="50" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="70" y="50" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
        <rect x="90" y="50" width="15" height="15" rx="3" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
      </g>
      
      {/* Screen (at bottom) */}
      <rect x="5" y="70" width="110" height="5" rx="2" fill="#a0aec0" />
      
      {/* Lighting effect on screen */}
      <rect x="5" y="70" width="110" height="5" rx="2" fill="url(#screenGlow)" opacity="0.7">
        <animate attributeName="opacity" values="0.4;0.7;0.4" dur="3s" repeatCount="indefinite" />
      </rect>
      
      {/* Screen glow gradient */}
      <defs>
        <linearGradient id="screenGlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#a0aec0" stopOpacity="0.2">
            <animate attributeName="stopColor" values="#a0aec0;#f6e05e;#a0aec0" dur="5s" repeatCount="indefinite" />
          </stop>
          <stop offset="50%" stopColor="#f6e05e" stopOpacity="0.8">
            <animate attributeName="stopColor" values="#f6e05e;#a0aec0;#f6e05e" dur="5s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#a0aec0" stopOpacity="0.2">
            <animate attributeName="stopColor" values="#a0aec0;#f6e05e;#a0aec0" dur="5s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
      </defs>
    </svg>
  </div>
);

export const TheaterLightsAnimation: React.FC = () => (
  <div className="w-48 h-32 relative transition-transform duration-500">
    <svg viewBox="0 0 120 80" className="w-full h-full filter drop-shadow-lg">
      {/* Ceiling */}
      <rect x="0" y="0" width="120" height="30" fill="#2d3748" />
      
      {/* Wall Sconces */}
      {[15, 45, 75, 105].map((x, i) => (
        <g key={i}>
          <rect x={x-5} y="10" width="10" height="15" rx="2" fill="#4a5568" stroke="#1a202c" strokeWidth="1" />
          <circle 
            cx={x} 
            cy="15" 
            r="4" 
            fill="#f6e05e" 
            className="animate-pulse"
            style={{ animationDuration: `${1.5 + i*0.3}s`, animationDelay: `${i*0.3}s` }}
          >
            <animate attributeName="fill" values="#f6e05e;#f7fafc;#f6e05e" dur="3s" begin={`${i*0.5}s`} repeatCount="indefinite" />
          </circle>
          <circle 
            cx={x} 
            cy="15" 
            r="8" 
            fill="transparent"
            stroke="#f6e05e" 
            strokeWidth="1"
            opacity="0.5"
            className="animate-ping"
            style={{ animationDuration: `${2 + i*0.3}s`, animationDelay: `${i*0.3}s` }}
          />
          
          {/* Light beam */}
          <path 
            d={`M${x},19 L${x-10},80 L${x+10},80 Z`} 
            fill="url(#lightBeam)" 
            opacity="0.2"
            className="transition-opacity duration-1000"
          >
            <animate attributeName="opacity" values="0.1;0.3;0.1" dur="3s" begin={`${i*0.5}s`} repeatCount="indefinite" />
          </path>
        </g>
      ))}
      
      {/* Stage Lights Beams with improved glow */}
      {[20, 60, 100].map((x, i) => (
        <g key={i} opacity={0.2 + (i * 0.1)} className="animate-pulse" style={{ animationDuration: `${3 + i}s`, animationDelay: `${i*0.5}s` }}>
          <path d={`M${x},0 L${x-15},80 L${x+15},80 Z`} fill="url(#stageLight)" />
        </g>
      ))}
      
      {/* Screen with animation */}
      <rect x="10" y="40" width="100" height="40" rx="2" fill="#a0aec0">
        <animate attributeName="fill" values="#a0aec0;#cbd5e0;#a0aec0" dur="5s" repeatCount="indefinite" />
      </rect>
      
      {/* Gradients */}
      <defs>
        <linearGradient id="lightBeam" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f6e05e" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#f6e05e" stopOpacity="0" />
        </linearGradient>
        
        <linearGradient id="stageLight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f6e05e" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#f6e05e" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

export const TriviaAnimation: React.FC = () => (
  <div className="w-32 h-32 relative transition-transform duration-500">
    <svg viewBox="0 0 100 100" className="w-full h-full filter drop-shadow-lg">
      {/* Film Reel */}
      <circle cx="50" cy="50" r="40" fill="#1a202c" stroke="#4a5568" strokeWidth="3" className="animate-spin" style={{ animationDuration: "20s", transformOrigin: "center" }} />
      <circle cx="50" cy="50" r="10" fill="#4a5568" stroke="#1a202c" strokeWidth="2" />
      
      {/* Reel Holes with pulsing effect */}
      {[0, 60, 120, 180, 240, 300].map((angle, i) => {
        const x = 50 + 25 * Math.cos(angle * Math.PI / 180);
        const y = 50 + 25 * Math.sin(angle * Math.PI / 180);
        return (
          <circle 
            key={i} 
            cx={x} 
            cy={y} 
            r="5" 
            fill="#4a5568" 
            stroke="#1a202c" 
            strokeWidth="1" 
            className="animate-pulse"
            style={{ animationDuration: `${2 + i*0.3}s`, animationDelay: `${i*0.2}s` }}
          />
        );
      })}
      
      {/* Film strip */}
      <g transform="rotate(10, 50, 50)">
        <path 
          d="M90,50 C90,72 72,90 50,90 C28,90 10,72 10,50 C10,28 28,10 50,10 C72,10 90,28 90,50 Z" 
          fill="none" 
          stroke="#4a5568" 
          strokeWidth="1" 
          strokeDasharray="5,5"
          className="animate-spin"
          style={{ animationDuration: "30s", transformOrigin: "center", animationDirection: "reverse" }}
        />
      </g>
      
      {/* Animated Question Mark */}
      <text 
        x="50" 
        y="55" 
        fontSize="40" 
        fill="#f6e05e" 
        textAnchor="middle" 
        className="animate-pulse" 
        style={{ animationDuration: "2s" }}
      >
        ?
        <animate attributeName="fill" values="#f6e05e;#f9a826;#f6e05e" dur="3s" repeatCount="indefinite" />
        <animateTransform 
          attributeName="transform"
          type="scale"
          values="1;1.1;1"
          dur="2s"
          repeatCount="indefinite"
          additive="sum"
        />
      </text>
    </svg>
  </div>
);