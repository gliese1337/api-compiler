const { expect } = require('chai');
const formulas = require('../test-lib/formulas');
const { Compiler } = require('../dist/compiler');

describe('Test Compilation', () => {
  const cmp = new Compiler(formulas);

  it('should calculate required parameters for salesCost', () => {
    const { params } = cmp.getParams(['salesCost']);
    expect(params).to.eql([
      'baseRate',
      'contractDefPenalty',
      'contractDiscRevShare',
      'contractLowRatePenalty',
      'saleRate',
      'upsideScale',
    ]);
  });

  it('should calculate required parameters for defaultTrigger', () => {
    const { params } = cmp.getParams(['defaultTrigger']);
    expect(params).to.eql([
      'saleEscFactor',
      'saleRate',
      'utilityEscFactor',
      'utilityRate',
    ]);
  });

  it('should calculate merged parameters', () => {
    const { params } = cmp.getParams(['salesCost','defaultTrigger']);
    expect(params).to.eql([
      'baseRate',
      'contractDefPenalty',
      'contractDiscRevShare',
      'contractLowRatePenalty',
      'saleEscFactor',
      'saleRate',
      'upsideScale',
      'utilityEscFactor',
      'utilityRate',
    ]);
  });

  it('should correctly compile a calculator function', () => {
    const [calc] = cmp.compile(['salesCost', 'upsideSlopeFactor']);
    expect(calc({
      'contractDiscRevShare': 0.5,
      'saleRate': 0.5,
      'baseRate': 0.5,
      'upsideScale': 3,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.eql({ salesCost: -0.5, upsideSlopeFactor: 1 });

    try {
      calc({
        'contractDiscRevShare': 0.5,
        'saleRate': 0.5,
        'contractLowRatePenalty': 0.5,
        'contractDefPenalty': 0.5,
      });
      expect(true).to.equal(false);
    } catch (e) {
      expect(e.message).to.equal("Missing arguments: Calculating [upsideSlopeFactor] requires [baseRate, upsideScale] as input");
    }
  });

  it('should revise requirements for salesCost given precomputed values', () => {
    const { params } = cmp.getParams(['salesCost'], ['upsideSlopeFactor']);
    expect(params).to.eql([
      'contractDefPenalty',
      'contractDiscRevShare',
      'contractLowRatePenalty',
      'upsideSlopeFactor',
    ]);
  });

  it('should revise requirements for salesCost & defaultTrigger given precomputed values', () => {
    const { params } = cmp.getParams(['salesCost', 'defaultTrigger'], ['upsideSlopeFactor']);
    expect(params).to.eql([
      'contractDefPenalty',
      'contractDiscRevShare',
      'contractLowRatePenalty',
      "saleEscFactor",
      "saleRate",
      'upsideSlopeFactor',
      "utilityEscFactor",
      "utilityRate",
    ]);
  });

  it('should correctly compile a shortcut calculator function', () => {
    const [calc] = cmp.compile(['salesCost'], ['upsideSlopeFactor']);
    expect(calc({
      'contractDiscRevShare': 0.5,
      'upsideSlopeFactor': 1,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.eql({ salesCost: -0.5 });
    expect(() => calc({
      'contractDiscRevShare': 0.5,
      'contractLowRatePenalty': 0.5,
      'contractDefPenalty': 0.5,
    })).to.throw(Error, "Missing arguments: Calculating [salesCost] requires [upsideSlopeFactor] as input");
  });
});
