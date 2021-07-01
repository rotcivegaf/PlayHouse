const TestFeeOwnable = artifacts.require('TestFeeOwnable.sol');

const {
  constants,
  expectEvent,
  expectRevert,
} = require('@openzeppelin/test-helpers');

const {
  expect,
  bn,
  random32bn,
  randombnBetween,
} = require('./helpers.js');

contract('FeeOwnable', (accounts) => {
  const feeOwner = accounts[1];
  const anAccount = accounts[2];

  let feeOwnable;

  let BASE;
  let MAX_FEE_RATE;

  function toFee (amount, feeRate) {
    return amount.mul(feeRate).div(BASE);
  };

  before('Deploy contracts', async () => {
    feeOwnable = await TestFeeOwnable.new({ from: feeOwner });
    BASE = await feeOwnable.BASE();
    MAX_FEE_RATE = await feeOwnable.MAX_FEE_RATE();
  });

  it('Constructor', async () => {
    const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

    expectEvent.inConstruction(
      _feeOwnable,
      'FeeOwnershipTransferred',
      { previousFeeOwner: constants.ZERO_ADDRESS, newFeeOwner: anAccount },
    );

    expect(await _feeOwnable.BASE()).to.eq.BN(10000);
    expect(await _feeOwnable.MAX_FEE_RATE()).to.eq.BN(500);
    expect(await _feeOwnable.feeOwnerRate()).to.eq.BN(0);
    assert.equal(await _feeOwnable.feeOwner(), anAccount);
  });
  it('Modifier onlyFeeOwner', async () => {
    await expectRevert(
      feeOwnable.testOnlyFeeOwner({ from: anAccount }),
      'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
    );

    await feeOwnable.testOnlyFeeOwner({ from: feeOwner });
  });
  it('Function renounceFeeOwnership', async () => {
    const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

    expectEvent(
      await _feeOwnable.renounceFeeOwnership({ from: anAccount }),
      'FeeOwnershipTransferred',
      { previousFeeOwner: anAccount, newFeeOwner: constants.ZERO_ADDRESS },
    );

    assert.equal(await _feeOwnable.feeOwner(), constants.ZERO_ADDRESS);
    expect(await _feeOwnable.feeOwnerRate()).to.eq.BN(0);
  });
  it('Function setExcludeFromFee', async () => {
    assert.isFalse(await feeOwnable.excludeFromFee(feeOwner));

    expectEvent(
      await feeOwnable.setExcludeFromFee(feeOwner, true, { from: feeOwner }),
      'SetExcludeFromFee',
      { account: feeOwner, exclude: true },
    );

    assert.isTrue(await feeOwnable.excludeFromFee(feeOwner));

    expectEvent(
      await feeOwnable.setExcludeFromFee(feeOwner, false, { from: feeOwner }),
      'SetExcludeFromFee',
      { account: feeOwner, exclude: false },
    );

    assert.isFalse(await feeOwnable.excludeFromFee(feeOwner));
  });
  describe('Functions transferFeeOwnership', async () => {
    it('Transfer fee ownership', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

      expectEvent(
        await _feeOwnable.transferFeeOwnership(feeOwner, { from: anAccount }),
        'FeeOwnershipTransferred',
        { previousFeeOwner: anAccount, newFeeOwner: feeOwner },
      );

      assert.equal(await _feeOwnable.feeOwner(), feeOwner);
    });
    it('Try transfer fee ownership to address 0', async () => {
      await expectRevert(
        feeOwnable.transferFeeOwnership(constants.ZERO_ADDRESS, { from: feeOwner }),
        'FeeOwnable::transferOwnership: new owner is the zero address',
      );
    });
  });
  describe('Function setFeeOwnerRate', async () => {
    it('Set fee owner rate', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

      expectEvent(
        await _feeOwnable.setFeeOwnerRate(bn(500), { from: anAccount }),
        'SetFeeOwnerRate',
        { feeOwnerRate: bn(500) },
      );

      expect(await _feeOwnable.feeOwnerRate()).to.eq.BN(bn(500));
    });
    it('Try set fee owner rate great than MAX_FEE_RATE', async () => {
      await expectRevert(
        feeOwnable.setFeeOwnerRate(MAX_FEE_RATE.add(bn(1)), { from: feeOwner }),
        'FeeOwnable::setFeeOwnerRate: The fee rate should be low or equal than MAX_FEE_RATE',
      );
    });
  });
  describe('Functions onlyFeeOwner', async () => {
    it('Try renounceFeeOwnership without be the fee owner', async () => {
      await expectRevert(
        feeOwnable.renounceFeeOwnership({ from: anAccount }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
    it('Try transferFeeOwnership without be the fee owner', async () => {
      await expectRevert(
        feeOwnable.transferFeeOwnership(anAccount, { from: anAccount }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
    it('Try setFeeOwnerRate without be the fee owner', async () => {
      await expectRevert(
        feeOwnable.setFeeOwnerRate(0, { from: anAccount }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
    it('Try setExcludeFromFee without be the fee owner', async () => {
      await expectRevert(
        feeOwnable.setExcludeFromFee(anAccount, true, { from: anAccount }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
  });
  describe('Function _getRateFeeOwnerAmount', async () => {
    it('With 0% fee', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

      expect(await _feeOwnable.getRateFeeOwnerAmount(0)).to.eq.BN(0);
      expect(await _feeOwnable.getRateFeeOwnerAmount(random32bn())).to.eq.BN(0);
    });
    it('With random fee', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });
      const feeRate = randombnBetween(1, 499);
      await _feeOwnable.setFeeOwnerRate(feeRate, { from: anAccount });

      expect(await _feeOwnable.getRateFeeOwnerAmount(0)).to.eq.BN(0);

      const amount = random32bn(30);
      expect(await _feeOwnable.getRateFeeOwnerAmount(amount)).to.eq.BN(toFee(amount, feeRate));
    });
    it('With MAX_FEE_RATE fee', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });
      await _feeOwnable.setFeeOwnerRate(bn(500), { from: anAccount });

      expect(await _feeOwnable.getRateFeeOwnerAmount(0)).to.eq.BN(0);

      const amount = random32bn(30);
      expect(await _feeOwnable.getRateFeeOwnerAmount(amount)).to.eq.BN(toFee(amount, MAX_FEE_RATE));
    });
  });
  describe('Function _getRateAmount', async () => {
    it('With 0% fee', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });

      expect(await _feeOwnable.getRateAmount(0, 0)).to.eq.BN(0);
      expect(await _feeOwnable.getRateAmount(random32bn(), 0)).to.eq.BN(0);
    });
    it('With random fee', async () => {
      const _feeOwnable = await TestFeeOwnable.new({ from: anAccount });
      const feeRate = randombnBetween(1, BASE);

      expect(await _feeOwnable.getRateAmount(0, feeRate)).to.eq.BN(0);

      const amount = random32bn(30);
      expect(await _feeOwnable.getRateAmount(amount, feeRate)).to.eq.BN(toFee(amount, feeRate));
    });
  });
});
