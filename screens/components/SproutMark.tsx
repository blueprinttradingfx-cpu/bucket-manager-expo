// screens/components/SproutMark.tsx
// Reusable "Ani" sprout brand mark - same leaf/stem paths as
// public/favicon.svg, minus the circular backdrop (the caller supplies
// that - e.g. SidebarNav's `brandMark` View). Keeps the mark visually
// identical between the web favicon and the in-app UI, per
// ani-branding-plan.md Tier 1.

import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  stemColor?: string;
}

const LEAF_COLOR = '#05B169';

export default function SproutMark({ size = 18, stemColor = '#FFFFFF' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M32 46 V27" stroke={stemColor} strokeWidth={3.5} strokeLinecap="round" />
      <Path d="M32 30 C32 19, 22 15, 15 16 C15 26, 22 31, 32 30 Z" fill={LEAF_COLOR} />
      <Path d="M32 26 C32 15, 42 11, 49 12 C49 22, 42 27, 32 26 Z" fill={LEAF_COLOR} />
    </Svg>
  );
}
