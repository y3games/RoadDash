/**
 * Steering input, unified.
 *
 * This module must never import Phaser. Keyboard and pointer arrive as plain
 * data and leave as one number, which is why there is no device branch anywhere
 * else in the game and why steering is testable without a browser.
 */

import { CAR } from './config';

export interface SteerKeys {
  readonly left: boolean;
  readonly right: boolean;
}

export interface SteerPointer {
  readonly down: boolean;
  readonly x: number;
}

/**
 * Steering in [-1, 1]: negative is left.
 *
 * A held key wins over the pointer, so a player on a laptop with a trackpad
 * down does not fight their own hand. Otherwise the pointer **seeks a
 * position**: the car is pulled toward the finger and saturates
 * `CAR.pointerRangePx` away from it, which feels like steering rather than like
 * a relative joystick, and needs no on-screen control.
 */
export function steerInput(keys: SteerKeys, pointer: SteerPointer | null, carX: number): number {
  const keyboard = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (keyboard !== 0) return keyboard;

  if (pointer !== null && pointer.down) {
    const offset = (pointer.x - carX) / CAR.pointerRangePx;
    return Math.min(Math.max(offset, -1), 1);
  }

  return 0;
}
