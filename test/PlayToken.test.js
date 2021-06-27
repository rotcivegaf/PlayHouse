const PlayToken = artifacts.require('PlayToken.sol');

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

contract('PlayToken', (accounts) => {
  const owner = accounts[1];
  const feeOwner = accounts[2];
  const anAccount = accounts[3];
  const from = accounts[4];
  const to = accounts[5];

  let playToken;

  let BASE;
  let MAX_BURN_RATE;

  const balances = {};

  async function saveBalances () {
    balances.owner = await playToken.balanceOf(owner);
    balances.feeOwner = await playToken.balanceOf(feeOwner);
    balances.anAccount = await playToken.balanceOf(anAccount);
    balances.from = await playToken.balanceOf(from);
    balances.to = await playToken.balanceOf(to);
  }

  function toFee (amount, feeRate) {
    return amount.mul(feeRate).div(BASE);
  };

  before('Deploy PlayManager', async () => {
    playToken = await PlayToken.new({ from: owner });
    await playToken.transferFeeOwnership(feeOwner, { from: owner });

    BASE = await playToken.BASE();
    MAX_BURN_RATE = await playToken.MAX_BURN_RATE();
  });

  it('Constructor', async () => {
    const _playToken = await PlayToken.new({ from: anAccount });

    expectEvent.inConstruction(
      _playToken,
      'SetExcludeFromFee',
      { account: anAccount, exclude: true },
    );

    assert.equal(await _playToken.name(), 'Play Token');
    assert.equal(await _playToken.symbol(), 'PLAY');

    expect(await _playToken.MAX_BURN_RATE()).to.eq.BN(500);
    expect(await _playToken.burnRate()).to.eq.BN(0);

    assert.isTrue(await _playToken.excludeFromFee(constants.ZERO_ADDRESS));
    assert.isTrue(await _playToken.excludeFromFee(anAccount));
  });
  it('Function mintTo', async () => {
    const amount = random32bn(3);
    await saveBalances();

    expectEvent(
      await playToken.mintTo(anAccount, amount, { from: owner }),
      'Transfer',
      { from: constants.ZERO_ADDRESS, to: anAccount, value: amount },
    );

    expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount.add(amount));
  });
  describe('Function setBurnRate', async () => {
    it('Set fee burn rate', async () => {
      const _playToken = await PlayToken.new({ from: anAccount });

      expectEvent(
        await _playToken.setBurnRate(bn(500), { from: anAccount }),
        'SetBurnRate',
        { burnRate: bn(500) },
      );

      expect(await _playToken.burnRate()).to.eq.BN(bn(500));
    });
    it('Try set fee burn rate great than MAX_BURN_RATE', async () => {
      await expectRevert(
        playToken.setBurnRate(MAX_BURN_RATE.add(bn(1)), { from: feeOwner }),
        'PlayToken::setBurnRate: The fee burn rate should be low or equal than MAX_BURN_RATE',
      );
    });
    it('Try setBurnRate without be the fee owner', async () => {
      await expectRevert(
        playToken.setBurnRate(0, { from: anAccount }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
  });
  describe('Functions onlyOwner', async () => {
    it('Try mintTo without be the owner', async () => {
      await expectRevert(
        playToken.mintTo(anAccount, constants.MAX_UINT256, { from: anAccount }),
        'Ownable: caller is not the owner',
      );
    });
  });
  describe('Functions _transfer', async () => {
    it('Transfer exclude from fee(from)', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      const burnRate = randombnBetween(1, 500);
      const feeRate = randombnBetween(1, 500);
      await playToken.setBurnRate(burnRate, { from: feeOwner });
      await playToken.setFeeOwnerRate(feeRate, { from: feeOwner });
      await playToken.setExcludeFromFee(from, true, { from: feeOwner });

      await saveBalances();

      expectEvent(
        await playToken.transfer(to, amount, { from: from }),
        'Transfer',
        { from: from, to: to, value: amount },
      );

      expect(await playToken.balanceOf(constants.ZERO_ADDRESS)).to.eq.BN(balances.address0);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner);
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount));

      await playToken.setBurnRate(0, { from: feeOwner });
      await playToken.setFeeOwnerRate(0, { from: feeOwner });
      await playToken.setExcludeFromFee(from, false, { from: feeOwner });
    });
    it('Transfer exclude from fee(to)', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      const burnRate = randombnBetween(1, 500);
      const feeRate = randombnBetween(1, 500);
      await playToken.setBurnRate(burnRate, { from: feeOwner });
      await playToken.setFeeOwnerRate(feeRate, { from: feeOwner });
      await playToken.setExcludeFromFee(to, true, { from: feeOwner });

      await saveBalances();

      expectEvent(
        await playToken.transfer(to, amount, { from: from }),
        'Transfer',
        { from: from, to: to, value: amount },
      );

      expect(await playToken.balanceOf(constants.ZERO_ADDRESS)).to.eq.BN(balances.address0);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner);
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount));

      await playToken.setBurnRate(0, { from: feeOwner });
      await playToken.setFeeOwnerRate(0, { from: feeOwner });
      await playToken.setExcludeFromFee(to, false, { from: feeOwner });
    });
    it('Transfer without burn and fee rate', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      await saveBalances();

      expectEvent(
        await playToken.transfer(to, amount, { from: from }),
        'Transfer',
        { from: from, to: to, value: amount },
      );

      expect(await playToken.balanceOf(constants.ZERO_ADDRESS)).to.eq.BN(balances.address0);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner);
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount));
    });
    it('Transfer with burn fee rate', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      await saveBalances();

      const rate = randombnBetween(1, 500);
      await playToken.setBurnRate(rate, { from: feeOwner });

      await playToken.transfer(to, amount, { from: from });

      const feeBurnAmount = toFee(amount, rate);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner);
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount.sub(feeBurnAmount)));

      await playToken.setBurnRate(0, { from: feeOwner });
    });
    it('Transfer with owner fee rate', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      const rate = randombnBetween(1, 500);
      await playToken.setFeeOwnerRate(rate, { from: feeOwner });

      await saveBalances();

      await playToken.transfer(to, amount, { from: from });

      const feeOwnerAmount = toFee(amount, rate);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner.add(feeOwnerAmount));
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount.sub(feeOwnerAmount)));

      await playToken.setFeeOwnerRate(0, { from: feeOwner });
    });
    it('Transfer with burn and owner fee rate', async () => {
      const amount = random32bn(3);
      await playToken.mintTo(from, amount, { from: owner });

      const burnRate = randombnBetween(1, 500);
      const feeRate = randombnBetween(1, 500);
      await playToken.setBurnRate(burnRate, { from: feeOwner });
      await playToken.setFeeOwnerRate(feeRate, { from: feeOwner });

      await saveBalances();

      await playToken.transfer(to, amount, { from: from });

      const feeBurnAmount = toFee(amount, burnRate);
      const feeOwnerAmount = toFee(amount, feeRate);
      expect(await playToken.balanceOf(owner)).to.eq.BN(balances.owner);
      expect(await playToken.balanceOf(feeOwner)).to.eq.BN(balances.feeOwner.add(feeOwnerAmount));
      expect(await playToken.balanceOf(anAccount)).to.eq.BN(balances.anAccount);
      expect(await playToken.balanceOf(from)).to.eq.BN(balances.from.sub(amount));
      expect(await playToken.balanceOf(to)).to.eq.BN(balances.to.add(amount.sub(feeBurnAmount.add(feeOwnerAmount))));

      await playToken.setBurnRate(0, { from: feeOwner });
      await playToken.setFeeOwnerRate(0, { from: feeOwner });
    });
  });
});
