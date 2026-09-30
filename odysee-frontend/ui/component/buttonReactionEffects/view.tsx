import React from 'react';
import { BUTTON_FIRE_EFFECT_CLASSES, BUTTON_SLIME_EFFECT_CLASSES } from 'component/button/classes';

export function ButtonFireEffect() {
  return (
    <>
      <div className={BUTTON_FIRE_EFFECT_CLASSES.glow} />
      {BUTTON_FIRE_EFFECT_CLASSES.particles.map((className) => (
        <div className={className} key={className} />
      ))}
    </>
  );
}

export function ButtonSlimeEffect() {
  return (
    <>
      <div className={BUTTON_SLIME_EFFECT_CLASSES.stain} />
      {BUTTON_SLIME_EFFECT_CLASSES.drops.map((className) => (
        <div className={className} key={className} />
      ))}
    </>
  );
}
