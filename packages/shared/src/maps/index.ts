import type { MapData } from '../map.ts';
import { city } from './city.ts';
import { desert } from './desert.ts';
import { figure8 } from './figure8.ts';
import { glacier } from './glacier.ts';
import { icelake } from './icelake.ts';
import { oval } from './oval.ts';

export const MAPS: Record<string, MapData> = {
  [oval.id]: oval,
  [city.id]: city,
  [figure8.id]: figure8,
  [icelake.id]: icelake,
  [desert.id]: desert,
  [glacier.id]: glacier,
};
