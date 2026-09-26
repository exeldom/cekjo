// Optional: node checks/check_game_rules.js (no dependencies).
require('../static/game/ellery-elric/rules.js');
const assert = require('node:assert/strict');
for (const character of ['ellery','elric']) {
  for (const obstacle of ['gate','rock']) {
    assert.equal(ElciRules.canOpen(character,false,obstacle),false);
    assert.equal(ElciRules.canOpen(character,true,obstacle),(character==='ellery')===(obstacle==='gate'));
  }
}
assert.equal(ElciRules.reward('ellery').name,'Coklat Astor');
assert.equal(ElciRules.reward('elric').name,'Roti Meises');
console.log('Game rules OK');
