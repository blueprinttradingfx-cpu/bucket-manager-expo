// screens/components/GrowthStageMark.tsx
// Ani branding plan, Tier 4: the per-bucket growth-stage mascot. Each stage
// is a reshape/recolor of the SAME leaf path used by SproutMark.tsx/the web
// favicon (per the plan's "3-4 simple recolor/reshape variants... not fully
// distinct illustrations" scope) - nothing here is a new illustration style.
//
// Colors default to the dark-on-light-card values (theme.ts onSurface /
// onSurfaceVariant), NOT SproutMark's white stem - that white only reads
// correctly on the blue circle backdrop SproutMark is normally composited
// onto (see SidebarNav's `brandMark` View). This component is meant to sit
// directly on a bucket card, so it needs to stand on its own.
//
// See core/bucketLogic.ts `computeBucketGrowthStage` for how `stage` here
// gets decided (blend of realized yield vs. the bucket's target, and how
// long it's been held).

import React from 'react';
import Svg, { Path, G, Ellipse } from 'react-native-svg';
import type { GrowthStage } from '../../core/bucketLogic';

interface Props {
  stage: GrowthStage;
  size?: number;
  /** Leaf/canopy color - defaults to the brand green. */
  leafColor?: string;
  /** Stem/trunk/seed color - defaults to a dark neutral (theme.ts onSurface),
   *  legible directly on a white/light card. Pass a lighter neutral (e.g.
   *  onSurfaceVariant) on a dark theme surface if needed. */
  stemColor?: string;
}

const LEAF1 = 'M32 30 C32 19, 22 15, 15 16 C15 26, 22 31, 32 30 Z';
const LEAF2 = 'M32 26 C32 15, 42 11, 49 12 C49 22, 42 27, 32 26 Z';

export default function GrowthStageMark({
  stage,
  size = 20,
  leafColor = '#05B169',
  stemColor = '#050F19',
}: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {stage === 'seed' && (
        // Dormant - no stem/leaves yet, deliberately the least "alive"-looking
        // stage. Muted neutral rather than green: nothing has grown yet.
        <Ellipse cx={32} cy={48} rx={7} ry={5} fill={stemColor} opacity={0.5} />
      )}

      {stage === 'sprout' && (
        <>
          <Path d="M32 46 V27" stroke={stemColor} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          <Path d={LEAF1} fill={leafColor} />
          <Path d={LEAF2} fill={leafColor} />
        </>
      )}

      {stage === 'sapling' && (
        <>
          {/* Taller stem than 'sprout', plus a second leaf pair shifted up
             -11 units - a genuinely taller silhouette at a glance, not just
             extra detail hidden inside the same outline. */}
          <Path d="M32 46 V15" stroke={stemColor} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          <Path d={LEAF1} fill={leafColor} />
          <Path d={LEAF2} fill={leafColor} />
          <G transform="translate(0,-11)">
            <Path d={LEAF1} fill={leafColor} />
            <Path d={LEAF2} fill={leafColor} />
          </G>
        </>
      )}

      {stage === 'tree' && (
        <>
          {/* Trunk + 3 copies of the SAME leaf path rotated 120deg apart
             around (32,34) - a full canopy cluster built from the one leaf
             shape, not a new illustration. */}
          <Path d="M32 52 V34" stroke={stemColor} strokeWidth={5} strokeLinecap="round" fill="none" />
          <G transform="rotate(0,32,34)"><Path d={LEAF1} fill={leafColor} /></G>
          <G transform="rotate(120,32,34)"><Path d={LEAF1} fill={leafColor} /></G>
          <G transform="rotate(240,32,34)"><Path d={LEAF1} fill={leafColor} /></G>
        </>
      )}
    </Svg>
  );
}
