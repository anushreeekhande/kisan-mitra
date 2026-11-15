import heroHarvestImg from '../assets/images/hero_fresh_harvest_1794730737202.jpg';
import tomatoImg from '../assets/images/veg_tomatoes_1794730737214.jpg';
import onionPotatoImg from '../assets/images/veg_onions_potatoes_1794730738529.jpg';
import fruitImg from '../assets/images/fruit_pomegranate_mango_1794730738044.jpg';
import leafyOkraImg from '../assets/images/veg_leafy_okra_1794730738675.jpg';

export const HERO_HARVEST_IMAGE = heroHarvestImg;

const PRODUCT_IMAGE_MAP: Record<string, string> = {
  tomato: tomatoImg,
  onion: onionPotatoImg,
  potato: onionPotatoImg,
  pomegranate: fruitImg,
  mango: fruitImg,
  okra: leafyOkraImg,
  spinach: leafyOkraImg,
  green_chilli: leafyOkraImg,
};

export function resolveProduceImage(photoUrlOrKey?: string | null, productKey?: string): string {
  if (photoUrlOrKey && (photoUrlOrKey.startsWith('data:image/') || photoUrlOrKey.startsWith('http'))) {
    return photoUrlOrKey;
  }
  if (photoUrlOrKey && PRODUCT_IMAGE_MAP[photoUrlOrKey]) {
    return PRODUCT_IMAGE_MAP[photoUrlOrKey];
  }
  if (productKey && PRODUCT_IMAGE_MAP[productKey]) {
    return PRODUCT_IMAGE_MAP[productKey];
  }
  return tomatoImg;
}
