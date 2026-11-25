// Presentation copy only; review data and validation retain their simulation metadata.
export function reviewCopy(text:string){
 return text.replace('Synthetic QA feedback only. This deterministic example demonstrates how a review will appear; it does not assess real content quality.','Review the scoring criteria and suggestions below.')
  .replaceAll('SIMULATION: example ','').replaceAll('SIMULATION: ','');
}
