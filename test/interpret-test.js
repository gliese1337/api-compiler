const { expect } = require('chai');
const formulas = require('../test-lib/formulas');
const { Compiler } = require('../dist/compiler');

describe('Test Immediate Interpretation', function() {
  const cmp = new Compiler(formulas);

  it('should calculate salesCost', async () => {
    expect(await cmp.interpret(['salesCost'], {
      'contractDiscRevShare': 0.5,
      'saleRate': 0.5,
      'baseRate': 0.5,
      'upsideScale': 3,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.eql({ salesCost: -0.5 });

    try {
      await cmp.interpret(['salesCost'], {
        'contractDiscRevShare': 0.5,
        'saleRate': 0.5,
        'contractLowRatePenalty': 0.5,
        'contractDefPenalty': 0.5,
      });
      expect(true).to.equal(false);
    } catch (e) {
      expect(e.message).to.equal("Cannot calculate [salesCost]; missing required input [baseRate].");
    }
  });

  it('should calculate salesCost with shortcut', async () => {
    expect(await cmp.interpret(['salesCost'], {
      'contractDiscRevShare': 0.5,
      'upsideSlopeFactor': 1,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.eql({ salesCost: -0.5 });
  });
});
