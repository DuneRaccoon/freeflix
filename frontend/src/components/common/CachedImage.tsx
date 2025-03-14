import React, { useState, useEffect } from 'react';
import Image, { ImageProps } from 'next/image';
import { assetsService } from '@/services/assets';

interface CachedImageProps extends Omit<ImageProps, 'src'> {
  src: string;
  fallbackSrc?: string;
  cacheOnLoad?: boolean;
}

/**
 * Component that displays an image with caching support
 * It will attempt to use a cached version of the image if available
 */
const CachedImage: React.FC<CachedImageProps> = ({
  src,
  fallbackSrc,
  cacheOnLoad = true,
  alt,
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState<string>(src);
  const [error, setError] = useState<boolean>(false);
  
  useEffect(() => {
    if (!src) return;
    
    // Reset state when src changes
    setImageSrc(src);
    setError(false);
    
    // Try to get cached URL
    const getCachedUrl = async () => {
      try {
        const cachedUrl = await assetsService.getCachedUrl(src, cacheOnLoad);
        if (cachedUrl && cachedUrl !== src) {
          setImageSrc(cachedUrl);
        }
      } catch (err) {
        console.error('Error getting cached URL:', err);
      }
    };
    
    getCachedUrl();
  }, [src, cacheOnLoad]);
  
  const handleError = () => {
    setError(true);
    if (fallbackSrc) {
      setImageSrc(fallbackSrc);
    }
  };
  
  return (
    <Image
      src={error && fallbackSrc ? fallbackSrc : imageSrc}
      alt={alt || ''}
      onError={handleError}
      {...props}
    />
  );
};

export default CachedImage;
