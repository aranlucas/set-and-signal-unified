import { z } from "zod";
import { plateLoad, round, type Unit } from "./workout";

export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export const LB_PLATES = [45, 35, 25, 10, 5, 2.5] as const;

export const PLATE_SIZES = { kg: KG_PLATES, lb: LB_PLATES };

/** Available pairs, aligned with PLATE_SIZES; both units survive unit changes. */
export interface PlateInventory {
  kg: number[];
  lb: number[];
}

export const PlateInventorySchema = z.object({
  kg: z.array(z.number().int().min(0).max(20)).length(KG_PLATES.length),
  lb: z.array(z.number().int().min(0).max(20)).length(LB_PLATES.length),
});

export const defaultPlateInventory = (): PlateInventory => ({
  kg: KG_PLATES.map(() => 4),
  lb: LB_PLATES.map(() => 4),
});

export function validPlateInventory(value: unknown): value is PlateInventory {
  return PlateInventorySchema.safeParse(value).success;
}

export interface PlateOption {
  perSide: { weight: number; count: number }[];
  loaded: number;
}

export interface PlateResult extends PlateOption {
  remainder: number;
  belowBar: boolean;
  exact: boolean;
  /** Inclusive when exact. There is no below option for a target below the bar. */
  below: PlateOption | null;
  above: PlateOption | null;
}

function enqueueCandidate(
  queue: Int16Array,
  best: Int16Array,
  residue: number,
  weight: number,
  amount: number,
  step: number,
  head: number,
  tail: number,
): number {
  if (best[amount] === 32767) {
    return tail;
  }

  while (
    head < tail &&
    best[residue + queue[tail - 1] * weight] - queue[tail - 1] >= best[amount] - step
  ) {
    tail--;
  }

  queue[tail] = step;

  return tail + 1;
}

/** Minimum-plate bounded knapsack, with a sliding minimum for each residue.
 * All denominations are multiples of five ticks (kg: .25, lb: .5); compress
 * that common factor. Compute the full inventory capacity so above is honest.
 * O(denominations × capacity) time and reconstruction space, no shared cache.
 */
export function loadPlates(
  target: number,
  bar: number,
  unit: Unit,
  inventory: PlateInventory | null,
): PlateResult {
  if (inventory === null) {
    const legacy = plateLoad(target, bar, unit);
    const loaded = round(bar + legacy.perSide.reduce((sum, p) => sum + 2 * p.weight * p.count, 0));
    const option = { perSide: legacy.perSide, loaded };
    const exact = !legacy.belowBar && legacy.remainder === 0;
    const aboveTotal = legacy.belowBar ? bar : round(loaded + (unit === "kg" ? 2.5 : 5));

    return {
      ...legacy,
      ...option,
      exact,
      below: legacy.belowBar ? null : option,
      above: exact
        ? option
        : {
            perSide: plateLoad(aboveTotal, bar, unit).perSide,
            loaded: aboveTotal,
          },
    };
  }

  const sizes = PLATE_SIZES[unit];
  const counts = inventory[unit];
  const quantum = (unit === "kg" ? 0.25 : 0.5) * 5;
  const weights = sizes.map((size) => size / quantum);
  const capacity = weights.reduce((sum, w, i) => sum + w * counts[i], 0);
  let best = new Int16Array(capacity + 1).fill(32767);
  best[0] = 0;
  const choices: Uint8Array[] = [];
  const queue = new Int16Array(capacity + 1);

  for (let i = 0; i < sizes.length; i++) {
    const w = weights[i];
    const next = new Int16Array(capacity + 1).fill(32767);
    const chosen = new Uint8Array(capacity + 1);

    for (let residue = 0; residue < w && residue <= capacity; residue++) {
      let head = 0;
      let tail = 0;

      for (let k = 0, amount = residue; amount <= capacity; k++, amount += w) {
        while (head < tail && queue[head] < k - counts[i]) {
          head++;
        }

        tail = enqueueCandidate(queue, best, residue, w, amount, k, head, tail);

        if (head < tail) {
          const previous = queue[head];
          next[amount] = best[residue + previous * w] + k - previous;
          chosen[amount] = k - previous;
        }
      }
    }

    best = next;
    choices.push(chosen);
  }

  const option = (amount: number): PlateOption => {
    const perSide: PlateOption["perSide"] = [];
    const loaded = round(bar + amount * quantum * 2);

    for (let i = sizes.length - 1; i >= 0; i--) {
      const count = choices[i][amount];

      if (count) {
        perSide.push({ weight: sizes[i], count });
      }

      amount -= count * weights[i];
    }

    perSide.reverse();

    return { loaded, perSide };
  };

  const desired = (target - bar) / (2 * quantum);
  let low = Math.min(capacity, Math.floor(desired + 1e-9));

  while (low >= 0 && best[low] === 32767) {
    low--;
  }

  let high = Math.max(0, Math.ceil(desired - 1e-9));

  while (high <= capacity && best[high] === 32767) {
    high++;
  }

  const below = low >= 0 ? option(low) : null;
  const above = high <= capacity ? option(high) : null;
  const loaded = below ?? above ?? option(0); // Empty bar is always loadable when no plate is lower.

  return {
    ...loaded,
    remainder: target < bar ? 0 : round(target - loaded.loaded),
    belowBar: target < bar,
    exact: Math.abs(loaded.loaded - target) < 1e-7,
    below,
    above,
  };
}
