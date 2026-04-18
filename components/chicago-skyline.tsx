"use client"

export function ChicagoSkyline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="xMidYMax slice"
    >
      {/* Chicago Skyline - Left to Right */}
      <g fill="currentColor">
        {/* Far left buildings */}
        <rect x="20" y="220" width="30" height="80" />
        <rect x="55" y="200" width="25" height="100" />
        <rect x="85" y="230" width="20" height="70" />
        
        {/* Marina Towers (corn cobs) */}
        <rect x="110" y="140" width="22" height="160" rx="3" />
        <rect x="115" y="135" width="12" height="5" />
        <rect x="137" y="145" width="22" height="155" rx="3" />
        <rect x="142" y="140" width="12" height="5" />
        
        {/* Buildings before Trump */}
        <rect x="165" y="180" width="35" height="120" />
        <rect x="205" y="160" width="28" height="140" />
        
        {/* Trump Tower */}
        <rect x="240" y="60" width="50" height="240" />
        <rect x="250" y="50" width="30" height="15" />
        <rect x="258" y="35" width="14" height="18" />
        <rect x="262" y="20" width="6" height="18" />
        
        {/* Wrigley Building */}
        <rect x="300" y="130" width="40" height="170" />
        <rect x="308" y="100" width="24" height="35" />
        <rect x="314" y="85" width="12" height="18" />
        <rect x="317" y="75" width="6" height="12" />
        
        {/* More mid buildings */}
        <rect x="348" y="170" width="32" height="130" />
        <rect x="385" y="150" width="40" height="150" />
        
        {/* Aon Center */}
        <rect x="432" y="50" width="55" height="250" />
        <rect x="445" y="42" width="28" height="10" />
        
        {/* Two Prudential Plaza */}
        <rect x="495" y="70" width="45" height="230" />
        <polygon points="517,70 495,95 540,95" />
        <rect x="512" y="50" width="10" height="22" />
        
        {/* Aqua Tower */}
        <rect x="548" y="85" width="42" height="215" />
        
        {/* Mid section buildings */}
        <rect x="598" y="160" width="35" height="140" />
        <rect x="638" y="140" width="30" height="160" />
        
        {/* Willis Tower (Sears Tower) - Iconic */}
        <rect x="680" y="25" width="35" height="275" />
        <rect x="715" y="40" width="35" height="260" />
        <rect x="680" y="60" width="70" height="240" />
        <rect x="690" y="15" width="15" height="15" />
        <rect x="695" y="0" width="5" height="18" />
        <rect x="725" y="30" width="15" height="15" />
        
        {/* 311 South Wacker */}
        <rect x="760" y="55" width="48" height="245" />
        <rect x="768" y="45" width="32" height="12" />
        <rect x="776" y="38" width="16" height="10" />
        
        {/* More buildings */}
        <rect x="815" y="120" width="35" height="180" />
        <rect x="855" y="100" width="40" height="200" />
        
        {/* John Hancock (now 875 N Michigan) */}
        <rect x="905" y="30" width="55" height="270" />
        <polygon points="905,30 960,30 955,300 910,300" />
        <rect x="920" y="15" width="25" height="18" />
        <rect x="927" y="0" width="10" height="18" />
        
        {/* More east side buildings */}
        <rect x="970" y="140" width="35" height="160" />
        <rect x="1010" y="110" width="42" height="190" />
        <rect x="1058" y="150" width="30" height="150" />
        <rect x="1093" y="180" width="35" height="120" />
        <rect x="1133" y="200" width="28" height="100" />
        <rect x="1166" y="220" width="34" height="80" />
      </g>
    </svg>
  )
}
