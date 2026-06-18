'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { StarIcon } from '@heroicons/react/24/solid';
import { motion } from 'framer-motion';

const hoverLiftVariants = {
  initial: { y: 0, scale: 1 },
  hover: { y: -4, scale: 1.02, transition: { duration: 0.2, ease: [0.0, 0.0, 0.2, 1] as const } },
};

const slideUp = {
  initial: { y: 10, opacity: 0 },
  animate: { y: 0, opacity: 1, transition: { duration: 0.3 } },
};

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.3 } },
};

interface ShowCardItem {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  genres: string[];
  vote_average: number;
}

interface ShowCardProps {
  show: ShowCardItem;
}

const ShowCard: React.FC<ShowCardProps> = ({ show }) => {
  const showId = show.tmdb_id.toString();

  return (
    <Link href={`/tv/${showId}`} prefetch={false}>
      <motion.div
        variants={hoverLiftVariants}
        initial="initial"
        whileHover="hover"
        className="h-full cursor-pointer group"
      >
        <Card className="h-full flex flex-col glass-card transition-all duration-300 hover:shadow-xl theater-shadow">
          <div className="relative pb-[150%] overflow-hidden">
            <Image
              src={show.poster_url || '/images/movie-placeholder.jpg'}
              alt={show.title}
              fill
              className="object-cover rounded-t-lg transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              priority={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 flex flex-col justify-end pointer-events-none">
              <motion.h3
                className="text-lg font-bold text-white line-clamp-2"
                variants={slideUp}
              >
                {show.title}
              </motion.h3>
              <motion.div
                className="flex items-center mt-1 text-sm text-gray-300"
                variants={fadeIn}
              >
                <span className="mr-2">{show.year ?? ''}</span>
                <div className="flex items-center">
                  <StarIcon className="w-4 h-4 text-yellow-500 mr-1" />
                  <span>{show.vote_average.toFixed(1)}</span>
                </div>
              </motion.div>
            </div>
          </div>

          <CardContent className="flex-grow flex flex-col justify-start p-3">
            <motion.div className="flex flex-wrap gap-1" variants={fadeIn}>
              {show.genres.map((genre, index) => (
                <motion.div key={index} variants={slideUp}>
                  <Badge variant="secondary" size="sm">
                    {genre}
                  </Badge>
                </motion.div>
              ))}
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </Link>
  );
};

export default ShowCard;
