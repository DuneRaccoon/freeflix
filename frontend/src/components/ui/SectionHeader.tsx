import React from 'react';
import { motion } from 'framer-motion';
import { slideUp, fadeIn } from '@/components/ui/Motion';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, right, className }) => {
  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <motion.h2 className="text-xl md:text-2xl font-semibold" variants={slideUp} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }}>
            {title}
          </motion.h2>
          {subtitle && (
            <motion.p className="text-sm text-gray-400 mt-1" variants={fadeIn} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.6 }}>
              {subtitle}
            </motion.p>
          )}
        </div>
        {right && (
          <motion.div variants={fadeIn} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.6 }}>
            {right}
          </motion.div>
        )}
      </div>
      <div className="mt-3 h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
    </div>
  );
};

export default SectionHeader;
