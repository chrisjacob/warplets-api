export function getTwitterCardImageUrl(imageUrl: string): string {
  return imageUrl.replace(/\.gif(?=($|[?#]))/i, ".png");
}
