// Self-contained so Puppeteer can run the same predicate inside the page.
export function stonkletShareContentReady(root: Pick<HTMLElement, "querySelector" | "querySelectorAll"> | null = document.querySelector<HTMLElement>('.stonklet-share-canvas')): boolean {
  if (!root || root.querySelector('.stonklets-chart-loading,[data-voters-ready="false"],[data-voter-image-ready="false"],[data-artwork-ready="false"]')) return false;
  const charts = Array.from(root.querySelectorAll<HTMLElement>('.stonklets-chart'));
  if (charts.length !== 2) return false;
  return charts.every(chart => {
    if (chart.dataset.chartReady === "artwork") {
      const artwork = chart.querySelector('img');
      return Boolean(artwork?.complete && artwork.naturalWidth > 0);
    }
    if (chart.dataset.chartReady !== "true") return false;
    const canvases = Array.from(chart.querySelectorAll('canvas'));
    return canvases.some(canvas => canvas.width > 1 && canvas.height > 1);
  });
}
