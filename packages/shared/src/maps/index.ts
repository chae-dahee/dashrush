import type { MapData } from '../map.ts';
import { city } from './city.ts';
import { oval } from './oval.ts';

export const MAPS: Record<string, MapData> = {
  [oval.id]: oval,
  [city.id]: city,
};
