const { expect } = require('chai');
const formulas = require('../test-lib/formulas');
const { Compiler } = require('../dist/compiler');

describe('Test Direct Calculation', function() {
  const cmp = new Compiler(formulas);
  it('should correctly cache compiled functions', () => {
    const calc = cmp.getCalculator(['salesCost', 'upsideSlopeFactor']);
    expect(cmp.getCalculator(['salesCost', 'upsideSlopeFactor'])).to.equal(calc);
  });

  it('should calculate salesCost', () => {
    expect(cmp.calculate(['salesCost', 'upsideSlopeFactor'], {
      'contractDiscRevShare': 0.5,
      'upsideSlopeFactor': 1,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.eql({ salesCost: -0.5, upsideSlopeFactor: 1 });
  });

  it('should calculate defaultTrigger', () => {
    expect(cmp.calculate(['defaultTrigger'], {
      saleRate: 0.5,
      saleEscFactor: 0.125,
      utilityRate: 0.25,
      utilityEscFactor: 0.125,
    })).to.eql({ defaultTrigger: 1 });
  });
});
