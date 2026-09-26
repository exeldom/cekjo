/* Shared with the single optional check; no runtime dependencies. */
globalThis.ElciRules = Object.freeze({
  canOpen: (character, powered, obstacle) => Boolean(powered && ((character === 'ellery' && obstacle === 'gate') || (character === 'elric' && obstacle === 'rock'))),
  reward: character => character === 'ellery' ? {image:'astor', name:'Coklat Astor'} : {image:'bread', name:'Roti Meises'}
});
