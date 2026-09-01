'use client';

import type { ReactNode } from 'react';
import {
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'motion/react';

import { cn } from '@queueforge/ui';

const premiumEase = [0.22, 1, 0.36, 1] as const;

export function CinematicMotionProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.34, ease: premiumEase }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

export function PageProgressRail(): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    damping: 34,
    mass: 0.18,
    stiffness: 220,
  });

  if (reducedMotion === true) return null;

  return <m.div aria-hidden="true" className="qf-page-progress" style={{ scaleX: progress }} />;
}

export function RouteReveal({
  children,
  routeKey,
}: {
  readonly children: ReactNode;
  readonly routeKey: string;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      animate={{ clipPath: 'inset(0 0 0 0)', opacity: 1 }}
      className="qf-route-reveal"
      initial={reducedMotion === true ? false : { clipPath: 'inset(0 0 0 18px)', opacity: 0.82 }}
      key={routeKey}
      transition={{ duration: 0.28, ease: premiumEase }}
    >
      {children}
    </m.div>
  );
}

export function HeroReveal({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      className="qf-hero-reveal"
      initial={reducedMotion === true ? false : { opacity: 0, scale: 0.99, y: 18 }}
      transition={{ duration: 0.48, ease: premiumEase }}
      viewport={{ amount: 0.12, once: true }}
      whileInView={reducedMotion === true ? undefined : { opacity: 1, scale: 1, y: 0 }}
    >
      {children}
    </m.div>
  );
}

interface ScrollRevealProps {
  readonly amount?: number;
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
}

export function ScrollReveal({
  amount = 0.16,
  children,
  className,
  delay = 0,
}: ScrollRevealProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      className={cn('qf-scroll-reveal', className)}
      data-scroll-reveal="true"
      initial={reducedMotion === true ? false : { opacity: 0, scale: 0.985, y: 20 }}
      transition={{ delay, duration: 0.48, ease: premiumEase }}
      viewport={{ amount, once: true }}
      whileInView={reducedMotion === true ? undefined : { opacity: 1, scale: 1, y: 0 }}
    >
      {children}
    </m.div>
  );
}

interface RevealGroupProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly stagger?: number;
}

function groupVisible(stagger: number): {
  readonly opacity: number;
  readonly transition: {
    readonly delayChildren: number;
    readonly staggerChildren: number;
  };
} {
  return {
    opacity: 1,
    transition: {
      delayChildren: 0.04,
      staggerChildren: stagger,
    },
  };
}

export function RevealGroup({
  children,
  className,
  stagger = 0.055,
}: RevealGroupProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      className={cn('qf-reveal-group', className)}
      initial={reducedMotion === true ? false : 'hidden'}
      variants={{
        hidden: { opacity: 1 },
        visible: reducedMotion === true ? { opacity: 1 } : groupVisible(stagger),
      }}
      viewport={{ amount: 0.12, once: true }}
      whileInView="visible"
    >
      {children}
    </m.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      className={cn('qf-reveal-item', className)}
      variants={
        reducedMotion === true
          ? undefined
          : {
              hidden: { opacity: 0, scale: 0.99, y: 16 },
              visible: {
                opacity: 1,
                scale: 1,
                transition: { duration: 0.4, ease: premiumEase },
                y: 0,
              },
            }
      }
    >
      {children}
    </m.div>
  );
}
