import React from 'react';
import { cn } from '@/lib/cn';

/** Decorative cinematic overlays (grain + house-light glow + vignette).
 *  Mount once per immersive surface. Purely visual; aria-hidden. */
const CinematicAtmosphere: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden="true" className={cn('ff-atmosphere', className)}>
    <span className="ff-glow" />
    <span className="ff-vignette" />
    <span className="ff-grain" />
  </div>
);

export default CinematicAtmosphere;
