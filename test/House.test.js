const House = artifacts.require('House.sol');
const PlayToken = artifacts.require('PlayToken.sol');

const TestERC20 = artifacts.require('TestERC20.sol');
const TestBetOracle = artifacts.require('TestBetOracle.sol');

const {
  constants,
  expectEvent,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');

const {
  expect,
  bn,
  toBytes32,
  random32bn,
  randombnBetween,
} = require('./helpers.js');

contract('House', (accounts) => {
  const owner = accounts[1];
  const creator = accounts[2];
  const player1 = accounts[3];
  const player2 = accounts[4];
  const anAccount = accounts[5];
  const feeOwner = accounts[6];

  let house;
  let oracle;
  let PLAY;
  let erc20;

  let BASE;

  const balances = {};

  function toFee (amount, feeRate) {
    return amount.mul(feeRate).div(BASE);
  };

  async function getRewardPlayAmount (betId, amount, maxRate) {
    const bet = await house.bets(betId);
    if (!maxRate)
      maxRate = bet.maxRate;

    const now = await time.latest();

    // deltaR = maxRate - minRate
    // deltaT = noMoreBets - startDecreaseRate
    // rate = ((deltaR / deltaT) * (noMoreBets - now)) - minRate;
    const deltaR = maxRate.sub(bet.minRate);
    const deltaT = bet.noMoreBets.sub(bet.startDecreaseRate);
    const rate = deltaR.div(deltaT).mul(bet.noMoreBets.sub(now)).add(bet.minRate);

    expect(rate).to.eq.BN(await house.getPlayRate(betId, now));

    return toFee(amount, rate);
  };

  async function getRewardCollectAmount (betId, amount, _house = house) {
    return toFee(amount, (await _house.bets(betId)).minRate);
  };

  function toOption (str) {
    return toBytes32(web3.utils.asciiToHex(str));
  };

  // For test oracle returns true
  const RETURN_TRUE = toOption('TRUE');

  async function setApproveBalance (beneficiary, amount, houseAddress = house.address) {
    await erc20.setBalance(beneficiary, amount);
    await erc20.approve(houseAddress, amount, { from: beneficiary });
  }

  async function saveBalances (id) {
    balances.erc20 = {};
    balances.erc20.house = await erc20.balanceOf(house.address);
    balances.erc20.owner = await erc20.balanceOf(owner);
    balances.erc20.feeOwner = await erc20.balanceOf(feeOwner);
    balances.erc20.player1 = await erc20.balanceOf(player1);

    balances.PLAY = {};
    balances.PLAY.house = await PLAY.balanceOf(house.address);
    balances.PLAY.owner = await PLAY.balanceOf(owner);
    balances.PLAY.feeOwner = await PLAY.balanceOf(feeOwner);
    balances.PLAY.player1 = await PLAY.balanceOf(player1);
  }

  function getId (sender, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, oracleData, houseAddress = house.address) {
    return web3.utils.soliditySha3(
      { t: 'address', v: houseAddress },
      { t: 'address', v: sender },
      { t: 'address', v: oracle.address },
      { t: 'address', v: erc20.address },
      { t: 'uint48', v: startDecreaseRate },
      { t: 'uint48', v: noMoreBets },
      { t: 'uint48', v: maxSetWinTime },
      { t: 'uint48', v: minRate },
      { t: 'uint48', v: maxRate },
      { t: 'uint256', v: salt },
      { t: 'bytes', v: oracleData },
    );
  }

  before('Deploy House', async () => {
    house = await House.new({ from: feeOwner });

    PLAY = await PlayToken.at(await house.PLAY());
    BASE = await house.BASE();

    oracle = await TestBetOracle.new(house.address, { from: owner });
    erc20 = await TestERC20.new({ from: owner });
  });

  it('Constructor', async () => {
    const _house = await House.new({ from: anAccount });

    assert.isTrue(await _house.excludeFromFee(await _house.PLAY()));
    assert.isTrue(await _house.canMigrate());
  });
  describe('Functions create', () => {
    it('Create a bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));

      expectEvent(
        await house.create(
          oracle.address,    // oracle
          erc20.address,     // erc20
          startDecreaseRate, // startDecreaseRate
          noMoreBets,        // noMoreBets
          maxSetWinTime,     // maxSetWinTime
          0,                 // minRate
          0,                 // maxRate
          0,                 // salt
          RETURN_TRUE,       // oracle data
          { from: creator },
        ),
        'Create',
        {
          oracle: oracle.address,
          erc20: erc20.address,
          startDecreaseRate: startDecreaseRate,
          noMoreBets: noMoreBets,
          maxSetWinTime: maxSetWinTime,
          minRate: bn(0),
          maxRate: bn(0),
          salt: bn(0),
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, 0, RETURN_TRUE));
      assert.equal(bet.oracle, oracle.address);
      assert.equal(bet.erc20, erc20.address);
      expect(bet.totalBalance).to.eq.BN(0);
      assert.equal(bet.winOption, constants.ZERO_BYTES32);
      expect(bet.startDecreaseRate).to.eq.BN(startDecreaseRate);
      expect(bet.noMoreBets).to.eq.BN(noMoreBets);
      expect(bet.setWinTime).to.eq.BN(maxSetWinTime);
      expect(bet.minRate).to.eq.BN(0);
      expect(bet.maxRate).to.eq.BN(0);
    });
    it('Create a bet with minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(100);
      const maxRate = bn(1000);

      expectEvent(
        await house.create(
          oracle.address,     // oracle
          erc20.address,      // erc20
          startDecreaseRate,  // startDecreaseRate
          noMoreBets,         // noMoreBets
          maxSetWinTime,      // maxSetWinTime
          minRate,            // minRate
          maxRate,            // maxRate
          0,                  // salt
          RETURN_TRUE,        // oracle data
          { from: feeOwner },
        ),
        'Create',
        {
          oracle: oracle.address,
          erc20: erc20.address,
          startDecreaseRate: startDecreaseRate,
          noMoreBets: noMoreBets,
          maxSetWinTime: maxSetWinTime,
          minRate: minRate,
          maxRate: maxRate,
          salt: bn(0),
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, 0, RETURN_TRUE));
      assert.equal(bet.oracle, oracle.address);
      assert.equal(bet.erc20, erc20.address);
      expect(bet.totalBalance).to.eq.BN(0);
      assert.equal(bet.winOption, constants.ZERO_BYTES32);
      expect(bet.startDecreaseRate).to.eq.BN(startDecreaseRate);
      expect(bet.noMoreBets).to.eq.BN(noMoreBets);
      expect(bet.setWinTime).to.eq.BN(maxSetWinTime);
      expect(bet.minRate).to.eq.BN(minRate);
      expect(bet.maxRate).to.eq.BN(maxRate);
    });
    it('Try create a bet with minRate and maxRate without fee ownership', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(100);
      const maxRate = bn(1000);

      expectEvent(
        await house.create(
          oracle.address,    // oracle
          erc20.address,     // erc20
          startDecreaseRate, // startDecreaseRate
          noMoreBets,        // noMoreBets
          maxSetWinTime,     // maxSetWinTime
          minRate,           // minRate
          maxRate,           // maxRate
          0,                 // salt
          RETURN_TRUE,       // oracle data
          { from: creator },
        ),
        'Create',
        {
          oracle: oracle.address,
          erc20: erc20.address,
          startDecreaseRate: startDecreaseRate,
          noMoreBets: noMoreBets,
          maxSetWinTime: maxSetWinTime,
          minRate: minRate,
          maxRate: maxRate,
          salt: bn(0),
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, 0, RETURN_TRUE));
      expect(bet.minRate).to.eq.BN(0);
      expect(bet.maxRate).to.eq.BN(0);
    });
    it('Try create a bet with address 0 as erc20', async () => {
      const now = await time.latest();

      await expectRevert(
        house.create(
          creator,                // oracle
          constants.ZERO_ADDRESS, // erc20
          now,                    // startDecreaseRate
          now.add(bn(30)),        // noMoreBets
          now.add(bn(60)),        // maxSetWinTime
          0,                      // minRate
          0,                      // maxRate
          random32bn(),           // salt
          RETURN_TRUE,            // oracle data
        ),
        'House::create: The bet erc20 is invalid',
      );
    });
    it('Try create a bet with wrong _noMoreBets', async () => {
      const now = await time.latest();

      await expectRevert(
        house.create(
          creator,         // oracle
          erc20.address,   // erc20
          now.add(bn(30)), // startDecreaseRate
          now.add(bn(30)), // noMoreBets
          now.add(bn(60)), // maxSetWinTime
          0,               // minRate
          0,               // maxRate
          random32bn(),    // salt
          RETURN_TRUE,     // oracle data
        ),
        'House::create: Wrong _noMoreBets',
      );
    });
    it('Try create a bet with wrong _maxSetWinTime', async () => {
      const now = await time.latest();

      await expectRevert(
        house.create(
          creator,         // oracle
          erc20.address,   // erc20
          now.add(bn(1)),  // startDecreaseRate
          now.add(bn(30)), // noMoreBets
          now.add(bn(30)), // maxSetWinTime
          0,               // minRate
          0,               // maxRate
          random32bn(),    // salt
          RETURN_TRUE,     // oracle data
        ),
        'House::create: Wrong _maxSetWinTime',
      );
    });
    it('Try create a bet with wrong rates', async () => {
      const now = await time.latest();

      await expectRevert(
        house.create(
          creator,         // oracle
          erc20.address,   // erc20
          now.add(bn(1)),  // startDecreaseRate
          now.add(bn(30)), // noMoreBets
          now.add(bn(60)), // maxSetWinTime
          1,               // minRate
          0,               // maxRate
          random32bn(),    // salt
          RETURN_TRUE,     // oracle data
        ),
        'House::create: Wrong rates',
      );
    });
    it('Try create two identical bets', async () => {
      const now = await time.latest();
      const startDecreaseRate = now.add(bn(5));
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));

      await house.create(
        oracle.address,    // oracle
        erc20.address,     // erc20
        startDecreaseRate, // startDecreaseRate
        noMoreBets,        // noMoreBets
        maxSetWinTime,     // maxSetWinTime
        0,                 // minRate
        0,                 // maxRate
        5,                 // salt
        RETURN_TRUE,       // oracle data
      );

      await expectRevert(
        house.create(
          oracle.address,    // oracle
          erc20.address,     // erc20
          startDecreaseRate, // startDecreaseRate
          noMoreBets,        // noMoreBets
          maxSetWinTime,     // maxSetWinTime
          0,                 // minRate
          0,                 // maxRate
          5,                 // salt
          RETURN_TRUE,       // oracle data
        ),
        'House::create: The bet is already create',
      );
    });
    it('Try create a bet with and oracle rejects the create', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));

      await expectRevert(
        house.create(
          oracle.address,    // oracle
          erc20.address,     // erc20
          startDecreaseRate, // startDecreaseRate
          noMoreBets,        // noMoreBets
          maxSetWinTime,     // maxSetWinTime
          0,                 // minRate
          0,                 // maxRate
          random32bn(),      // salt
          [],                // oracle data
        ),
        'House::create: The bet oracle reject the create',
      );
    });
    it('Try create a bet with address 0 as oracle', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));

      await expectRevert(
        house.create(
          constants.ZERO_ADDRESS, // oracle
          erc20.address,          // erc20
          startDecreaseRate,      // startDecreaseRate
          noMoreBets,             // noMoreBets
          maxSetWinTime,          // maxSetWinTime
          0,                      // minRate
          0,                      // maxRate
          random32bn(),           // salt
          RETURN_TRUE,            // oracle data
        ),
        'Transaction reverted: function call to a non-contract account',
      );
    });
  });
  describe('Function play', () => {
    it('Play a bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await saveBalances();

      expectEvent(
        await house.play(
          betId,
          amount,
          option,
          RETURN_TRUE,
          { from: player1 },
        ),
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: bn(0),
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Play a bet with owner fee', async () => {
      const feeRate = randombnBetween(1, 500);
      await house.setFeeOwnerRate(feeRate, { from: feeOwner });

      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const feeAmount = await toFee(amount, feeRate);
      const netAmount = amount.sub(feeAmount);
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await saveBalances();

      expectEvent(
        await house.play(
          betId,
          amount,
          option,
          RETURN_TRUE,
          { from: player1 },
        ),
        'Play',
        {
          betId: betId,
          amount: netAmount,
          reward: bn(0),
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(netAmount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(netAmount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(netAmount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(netAmount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner.add(feeAmount));
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);

      await house.setFeeOwnerRate(bn(0), { from: feeOwner });
    });
    it('Play a bet with owner fee and the token is excluded from fee', async () => {
      const feeRate = randombnBetween(1, 500);
      await house.setFeeOwnerRate(feeRate, { from: feeOwner });
      await house.setExcludeFromFee(erc20.address, true, { from: feeOwner });

      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await saveBalances();

      expectEvent(
        await house.play(
          betId,
          amount,
          option,
          RETURN_TRUE,
          { from: player1 },
        ),
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: bn(0),
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);

      await house.setFeeOwnerRate(bn(0), { from: feeOwner });
      await house.setExcludeFromFee(erc20.address, false, { from: feeOwner });
    });
    it('Play a bet with equal minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await saveBalances();

      const receipt = await house.play(
        betId,
        amount,
        option,
        RETURN_TRUE,
        { from: player1 },
      );
      const rewardAmount = await getRewardPlayAmount(betId, amount);

      expectEvent(
        receipt,
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: rewardAmount,
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Play a bet with 0 minRate and 0 maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(0);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await saveBalances();

      const receipt = await house.play(
        betId,
        amount,
        option,
        RETURN_TRUE,
        { from: player1 },
      );
      const rewardAmount = await getRewardPlayAmount(betId, amount);

      expectEvent(
        receipt,
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: rewardAmount,
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Play a bet with minRate and 0 maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await saveBalances();

      const receipt = await house.play(
        betId,
        amount,
        option,
        RETURN_TRUE,
        { from: player1 },
      );
      const rewardAmount = await getRewardPlayAmount(betId, amount);

      expectEvent(
        receipt,
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: rewardAmount,
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Play a bet with minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await saveBalances();

      const receipt = await house.play(
        betId,
        amount,
        option,
        RETURN_TRUE,
        { from: player1 },
      );
      const rewardAmount = await getRewardPlayAmount(betId, amount);

      expectEvent(
        receipt,
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: rewardAmount,
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Play a bet with maxRate and foward startDecreaseRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now.add(bn(15));
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await saveBalances();

      const receipt = await house.play(
        betId,
        amount,
        option,
        RETURN_TRUE,
        { from: player1 },
      );
      const rewardAmount = await getRewardPlayAmount(betId, amount, maxRate);

      expectEvent(
        receipt,
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: rewardAmount,
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.sub(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Play a bet with minRate and maxRate in a migrated house(PLAY token = address 0)', async () => {
      const _house = await House.new({ from: owner });
      await _house.transferFeeOwnership(feeOwner, { from: owner });
      const _PLAY = await PlayToken.at(await _house.PLAY());
      await _house.migrate(owner, { from: feeOwner });

      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, _house.address);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await _house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount, _house.address);

      const balanceErc20House = await erc20.balanceOf(_house.address);
      const balanceErc20Owner = await erc20.balanceOf(owner);
      const balanceErc20FeeOwner = await erc20.balanceOf(feeOwner);
      const balanceErc20Player1 = await erc20.balanceOf(player1);

      const balancePLAYHouse = await _PLAY.balanceOf(_house.address);
      const balancePLAYOwner = await _PLAY.balanceOf(owner);
      const balancePLAYFeeOwner = await _PLAY.balanceOf(feeOwner);
      const balancePLAYPlayer1 = await _PLAY.balanceOf(player1);

      expectEvent(
        await _house.play(
          betId,
          amount,
          option,
          RETURN_TRUE,
          { from: player1 },
        ),
        'Play',
        {
          betId: betId,
          amount: amount,
          reward: bn(0),
          option: option,
          oracleData: RETURN_TRUE,
        },
      );

      const bet = await _house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await _house.getBetBalanceOf(betId, player1)).to.eq.BN(amount);
      assert.equal(await _house.getBetOptionOf(betId, player1), option);
      expect(await _house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(_house.address)).to.eq.BN(balanceErc20House.add(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balanceErc20Owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balanceErc20FeeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balanceErc20Player1.sub(amount));

      // Check PLAY balance
      expect(await _PLAY.balanceOf(_house.address)).to.eq.BN(balancePLAYHouse);
      expect(await _PLAY.balanceOf(owner)).to.eq.BN(balancePLAYOwner);
      expect(await _PLAY.balanceOf(feeOwner)).to.eq.BN(balancePLAYFeeOwner);
      expect(await _PLAY.balanceOf(player1)).to.eq.BN(balancePLAYPlayer1);
    });
    it('Try play a nonexistent bet', async () => {
      await expectRevert(
        house.play(
          constants.ZERO_BYTES32,
          bn(0),
          constants.ZERO_BYTES32,
          RETURN_TRUE,
        ),
        'House::play: The bet is closed or not exists',
      );
    });
    it('Try play an expired bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now.add(bn(10));
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      await expectRevert(
        house.play(
          betId,
          bn(0),
          constants.ZERO_BYTES32,
          RETURN_TRUE,
        ),
        'House::play: The bet is closed or not exists',
      );
    });
    it('Try play 0 amount in a bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await expectRevert(
        house.play(
          betId,
          bn(0),
          constants.ZERO_BYTES32,
          RETURN_TRUE,
        ),
        'House::play: The amount should not be 0',
      );
    });
    it('Try play a bet with two different options', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(creator, 11);
      await house.play(betId, 10, toOption('A'), RETURN_TRUE, { from: creator });

      await expectRevert(
        house.play(
          betId,
          1,
          constants.ZERO_BYTES32,
          RETURN_TRUE,
          { from: creator },
        ),
        'House::play: The option is invalid',
      );
    });
    it('Try play a bet with invalid option', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await expectRevert(
        house.play(
          betId,
          1,
          constants.ZERO_BYTES32,
          RETURN_TRUE,
        ),
        'House::play: The option is invalid',
      );
    });
    it('Try play a bet with invalid option(change option)', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(creator, 11);
      await house.play(betId, 10, toOption('A'), RETURN_TRUE, { from: creator });

      await expectRevert(
        house.play(
          betId,
          1,
          toOption('B'),
          RETURN_TRUE,
          { from: creator },
        ),
        'House::play: The option cant change',
      );
    });
    it('Try play a bet and oracle rejects the play', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(creator, 1);

      await expectRevert(
        house.play(
          betId,
          1,
          toOption('A'),
          [],
          { from: creator },
        ),
        'House::play: The bet oracle reject the play',
      );
    });
    it('Try play a bet without have erc20 balance', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await expectRevert(
        house.play(
          betId,
          bn('100000000000000000000000000'),
          toOption('A'),
          RETURN_TRUE,
        ),
        'ERC20: transfer amount exceeds balance',
      );
    });
  });
  describe('Function setWinOption', () => {
    it('Set the win option in a bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      expectEvent.inTransaction(
        (await oracle.setWinOption(betId, option)).tx,
        house,
        'SetWinOption',
        { betId: betId, option: option }
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
    });
    it('Try set the win option in a nonexistent bet', async () => {
      await expectRevert(
        house.setWinOption(
          constants.ZERO_BYTES32,
          toOption('A'),
          { from: creator },
        ),
        'House::setWinOption: The tx sender is invalid or not exists',
      );
    });
    it('Try set the win option without be the oracle of the bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      await expectRevert(
        house.setWinOption(
          betId,
          toOption('A'),
          { from: player1 },
        ),
        'House::setWinOption: The tx sender is invalid or not exists',
      );
    });
    it('Try set the win option in a bet in emergency', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).setWinTime);

      await expectRevert(
        oracle.setWinOption(
          betId,
          toOption('A'),
        ),
        'House::setWinOption: The bet is in emergency',
      );
    });
    it('Try set the win option in ongoing bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets.sub(bn(3)));

      await expectRevert(
        oracle.setWinOption(
          betId,
          toOption('A'),
        ),
        'House::setWinOption: The bet is not closed',
      );
    });
    it('Try set the win option twice', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      await oracle.setWinOption(betId, toOption('A'));

      await expectRevert(
        oracle.setWinOption(
          betId,
          toOption('B'),
        ),
        'House::setWinOption: The bet is in emergency or the win option was set',
      );
    });
    it('Try set bytes32 0 as win option bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      await expectRevert(
        oracle.setWinOption(
          betId,
          constants.ZERO_BYTES32,
        ),
        'House::setWinOption: The win option is invalid',
      );
    });
  });
  describe('Function collect', () => {
    it('Collect a win bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a win bet with equal minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(rewardAmount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(rewardAmount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(rewardAmount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(rewardAmount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Collect a win bet with 0 minRate and 0 maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(0);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a win bet with 0 minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a win bet with minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Collect a win bet with minRate and maxRate in a migrated house(PLAY token = address 0)', async () => {
      const _house = await House.new({ from: owner });
      await _house.transferFeeOwnership(feeOwner, { from: owner });
      const _oracle = await TestBetOracle.new(_house.address, { from: owner });
      const _PLAY = await PlayToken.at(await _house.PLAY());
      await _house.migrate(owner, { from: feeOwner });

      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, _oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, _house.address);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await _house.create(_oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount, _house.address);

      await _house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await _house.bets(betId)).noMoreBets);
      await _oracle.setWinOption(betId, option);

      const balanceErc20House = await erc20.balanceOf(_house.address);
      const balanceErc20Owner = await erc20.balanceOf(owner);
      const balanceErc20FeeOwner = await erc20.balanceOf(feeOwner);
      const balanceErc20Player1 = await erc20.balanceOf(player1);

      const balancePLAYHouse = await _PLAY.balanceOf(_house.address);
      const balancePLAYOwner = await _PLAY.balanceOf(owner);
      const balancePLAYFeeOwner = await _PLAY.balanceOf(feeOwner);
      const balancePLAYPlayer1 = await _PLAY.balanceOf(player1);

      expectEvent(
        await _house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: bn(0), oracleData: RETURN_TRUE },
      );

      const bet = await _house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await _house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await _house.getBetOptionOf(betId, player1), option);
      expect(await _house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(_house.address)).to.eq.BN(balanceErc20House.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balanceErc20Owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balanceErc20FeeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balanceErc20Player1.add(amount));

      // Check PLAY balance
      expect(await _PLAY.balanceOf(_house.address)).to.eq.BN(balancePLAYHouse);
      expect(await _PLAY.balanceOf(owner)).to.eq.BN(balancePLAYOwner);
      expect(await _PLAY.balanceOf(feeOwner)).to.eq.BN(balancePLAYFeeOwner);
      expect(await _PLAY.balanceOf(player1)).to.eq.BN(balancePLAYPlayer1);
    });
    it('Collect a draw bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });
      await setApproveBalance(player1, amount);
      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });
      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, winOption);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);
      expect(await house.getBetOptionBalance(betId, winOption)).to.eq.BN(0);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a draw bet with equal minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, winOption);
      expect(bet.totalBalance).to.eq.BN(rewardAmount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(rewardAmount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(rewardAmount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(rewardAmount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Collect a draw bet with 0 minRate and 0 maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(0);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, winOption);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a draw bet with 0 minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(0);
      const maxRate = bn(10000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, winOption);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Collect a draw bet with minRate and maxRate', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      const rewardAmount = await getRewardCollectAmount(betId, amount);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: rewardAmount, oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, winOption);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1.add(rewardAmount));
    });
    it('Collect a draw bet with minRate and maxRate in a migrated house(PLAY token = address 0)', async () => {
      const _house = await House.new({ from: owner });
      await _house.transferFeeOwnership(feeOwner, { from: owner });
      const _oracle = await TestBetOracle.new(_house.address, { from: owner });
      const _PLAY = await PlayToken.at(await _house.PLAY());
      await _house.migrate(owner, { from: feeOwner });

      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const minRate = bn(10000);
      const maxRate = bn(20000);
      const salt = random32bn();
      const betId = getId(feeOwner, _oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, _house.address);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');
      const winOption = toOption('B');

      await _house.create(_oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate, salt, RETURN_TRUE, { from: feeOwner });

      await setApproveBalance(player1, amount, _house.address);

      await _house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await _house.bets(betId)).noMoreBets);
      await _oracle.setWinOption(betId, winOption);

      const balanceErc20House = await erc20.balanceOf(_house.address);
      const balanceErc20Owner = await erc20.balanceOf(owner);
      const balanceErc20FeeOwner = await erc20.balanceOf(feeOwner);
      const balanceErc20Player1 = await erc20.balanceOf(player1);

      const balancePLAYHouse = await _PLAY.balanceOf(_house.address);
      const balancePLAYOwner = await _PLAY.balanceOf(owner);
      const balancePLAYFeeOwner = await _PLAY.balanceOf(feeOwner);
      const balancePLAYPlayer1 = await _PLAY.balanceOf(player1);

      expectEvent(
        await _house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: amount, reward: bn(0), oracleData: RETURN_TRUE },
      );

      const bet = await _house.bets(betId);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await _house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await _house.getBetOptionOf(betId, player1), option);
      expect(await _house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(_house.address)).to.eq.BN(balanceErc20House.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balanceErc20Owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balanceErc20FeeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balanceErc20Player1.add(amount));

      // Check PLAY balance
      expect(await _PLAY.balanceOf(_house.address)).to.eq.BN(balancePLAYHouse);
      expect(await _PLAY.balanceOf(owner)).to.eq.BN(balancePLAYOwner);
      expect(await _PLAY.balanceOf(feeOwner)).to.eq.BN(balancePLAYFeeOwner);
      expect(await _PLAY.balanceOf(player1)).to.eq.BN(balancePLAYPlayer1);
    });
    it('Collect a lose bet', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option1 = toOption('A');
      const option2 = toOption('B');
      const winOption = toOption('B');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: feeOwner });
      await setApproveBalance(player1, amount);
      await house.play(betId, amount, option1, RETURN_TRUE, { from: player1 });
      await setApproveBalance(player2, amount);
      await house.play(betId, amount, option2, RETURN_TRUE, { from: player2 });
      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, winOption);

      await expectRevert(
        house.collect(
          betId,
          RETURN_TRUE,
          { from: player1 },
        ),
        'House::collect: The sender lose or not play',
      );
    });
    it('Try collect a nonexistent bet', async () => {
      await expectRevert(
        house.collect(
          constants.ZERO_BYTES32,
          RETURN_TRUE,
        ),
        'House::collect: The sender not have balance',
      );
    });
    it('Try collect twice and try collect without play', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const option = toOption('A');
      const amount = bn(web3.utils.randomHex(8));

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: feeOwner });
      await setApproveBalance(player1, amount);
      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      // Try collect a bet with no win option
      await expectRevert(
        house.collect(
          betId,
          RETURN_TRUE,
          { from: player1 },
        ),
        'House::collect: The win option is not set or not exists',
      );

      await time.increaseTo((await house.bets(betId)).noMoreBets);

      // Past time and try collect a bet with no win option
      await expectRevert(
        house.collect(
          betId,
          RETURN_TRUE,
          { from: player1 },
        ),
        'House::collect: The win option is not set or not exists',
      );

      await oracle.setWinOption(betId, option);
      await house.collect(betId, RETURN_TRUE, { from: player1 });

      // Try collect as creator(not play)
      await expectRevert(
        house.collect(
          betId,
          RETURN_TRUE,
          { from: creator },
        ),
        'House::collect: The sender lose or not play',
      );

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'Collect',
        { betId: betId, amount: bn(0), oracleData: RETURN_TRUE },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, option);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house);
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1);

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Try collect a bet and oracle rejects the collect', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(feeOwner, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const option = toOption('A');
      const amount = bn(web3.utils.randomHex(8));

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: feeOwner });
      await setApproveBalance(player1, amount);
      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });
      await time.increaseTo((await house.bets(betId)).noMoreBets);
      await oracle.setWinOption(betId, option);

      await expectRevert(
        house.collect(
          betId,
          [],
          { from: player1 },
        ),
        'House::collect: The bet oracle reject the collect',
      );
    });
    // Emergency collect
    it('Collect a bet in emergency', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });

      await time.increaseTo((await house.bets(betId)).setWinTime);

      await saveBalances();

      expectEvent(
        await house.collect(betId, RETURN_TRUE, { from: player1 }),
        'EmergencyWithdraw',
        { betId: betId, amount: amount },
      );

      const bet = await house.bets(betId);
      assert.equal(bet.winOption, constants.ZERO_BYTES32);
      expect(bet.totalBalance).to.eq.BN(amount);

      expect(await house.getBetBalanceOf(betId, player1)).to.eq.BN(0);
      assert.equal(await house.getBetOptionOf(betId, player1), option);
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(amount);

      // Check ERC20 balance
      expect(await erc20.balanceOf(house.address)).to.eq.BN(balances.erc20.house.sub(amount));
      expect(await erc20.balanceOf(owner)).to.eq.BN(balances.erc20.owner);
      expect(await erc20.balanceOf(feeOwner)).to.eq.BN(balances.erc20.feeOwner);
      expect(await erc20.balanceOf(player1)).to.eq.BN(balances.erc20.player1.add(amount));

      // Check PLAY balance
      expect(await PLAY.balanceOf(house.address)).to.eq.BN(balances.PLAY.house);
      expect(await PLAY.balanceOf(owner)).to.eq.BN(balances.PLAY.owner);
      expect(await PLAY.balanceOf(feeOwner)).to.eq.BN(balances.PLAY.feeOwner);
      expect(await PLAY.balanceOf(player1)).to.eq.BN(balances.PLAY.player1);
    });
    it('Try collect a bet in emergency without play on it', async () => {
      const now = await time.latest();
      const startDecreaseRate = now;
      const noMoreBets = now.add(bn(30));
      const maxSetWinTime = now.add(bn(60));
      const salt = random32bn();
      const betId = getId(creator, oracle, erc20, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE);
      const amount = bn(web3.utils.randomHex(8));
      const option = toOption('A');

      await house.create(oracle.address, erc20.address, startDecreaseRate, noMoreBets, maxSetWinTime, 0, 0, salt, RETURN_TRUE, { from: creator });

      await setApproveBalance(player1, amount);

      await house.play(betId, amount, option, RETURN_TRUE, { from: player1 });
      await time.increaseTo((await house.bets(betId)).setWinTime);

      await saveBalances();

      await expectRevert(
        house.collect(betId, RETURN_TRUE, { from: feeOwner }),
        'House::collect: The sender not have balance',
      );
    });
  });
  describe('Function renounceMigrate', async () => {
    it('Renounce migrate', async () => {
      const _house = await House.new({ from: owner });

      await _house.renounceMigrate({ from: owner });

      assert.isFalse(await _house.canMigrate());
    });
    it('Try renounce migrate without be the fee owner', async () => {
      await expectRevert(
        house.renounceMigrate({ from: owner }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
  });
  describe('Function migrate', async () => {
    it('Migrate to a new house contract', async () => {
      const _house = await House.new({ from: owner });
      const _PLAY = await PlayToken.at(await _house.PLAY());

      await _house.migrate(owner, { from: owner });

      assert.equal(await _PLAY.owner(), owner);
    });
    it('Try migrate without be the fee owner', async () => {
      await expectRevert(
        house.migrate(owner, { from: owner }),
        'FeeOwnable::onlyFeeOwner: caller is not the fee owner',
      );
    });
    it('Try migrate when fee owner was renounce', async () => {
      const _house = await House.new({ from: owner });
      await _house.renounceMigrate({ from: owner });

      await expectRevert(
        _house.migrate(owner, { from: owner }),
        'House::migrate: The fee owner was renounce to migrate',
      );
    });
  });
});
