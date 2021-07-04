const House = artifacts.require('House.sol');
const PlayToken = artifacts.require('PlayToken.sol');

const TestERC20 = artifacts.require('TestERC20.sol');
const TestBetOracle = artifacts.require('TestBetOracle.sol');

const {
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');

const {
  expect,
  bn,
  toBytes32,
  randombnBetween,
} = require('./helpers.js');

contract('House Integration', (accounts) => {
  const owner = accounts[1];
  const feeOwner = accounts[2];

  let house;
  let houseFeeRate;
  let PLAY;
  let PLAYBurnRate;
  let PLAYFeeRate;
  let erc20;
  let oracle;

  let BASE;

  function toRateAmount (amount, rate) {
    return amount.sub(amount.mul(rate).div(BASE));
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

  function processPlayer (players, winOption) {
    const expects = [];
    const optionBalances = {};
    let betBalance = bn(0);

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      player.amountPlay = [];
      const expect = {};

      expect.betPlayerBalance = bn(0);
      for (let j = 0; j < player.playSteps; j++) {
        player.amountPlay[j] = bn(web3.utils.randomHex(8));
        // Player balance
        expect.betPlayerBalance = expect.betPlayerBalance.add(toRateAmount(player.amountPlay[j], houseFeeRate));
      }
      player.option = toOption(player.option);

      // Option balances
      if (!optionBalances[player.option])
        optionBalances[player.option] = bn(0);

      optionBalances[player.option] = optionBalances[player.option].add(expect.betPlayerBalance);

      // Bet balance
      betBalance = betBalance.add(expect.betPlayerBalance);

      expects.push(expect);
    }

    return {
      players,
      winOption,
      expects,
      optionBalances,
      betBalance,
    };
  }

  function getId (minPlayAmount, minPlayAmountRateIncrease, startDecreaseRate, noMoreBets, maxSetWinTime, minRate, maxRate) {
    return web3.utils.soliditySha3(
      { t: 'address', v: house.address },
      { t: 'address', v: feeOwner },
      { t: 'address', v: oracle.address },
      { t: 'address', v: erc20.address },
      { t: 'uint208', v: minPlayAmount },
      { t: 'uint48', v: minPlayAmountRateIncrease },
      { t: 'uint48', v: startDecreaseRate },
      { t: 'uint48', v: noMoreBets },
      { t: 'uint48', v: maxSetWinTime },
      { t: 'uint48', v: minRate },
      { t: 'uint48', v: maxRate },
      { t: 'bytes', v: RETURN_TRUE },
    );
  }

  before('Deploy House', async () => {
    house = await House.new({ from: feeOwner });
    PLAY = await PlayToken.at(await house.PLAY());
    BASE = await house.BASE();

    houseFeeRate = randombnBetween(1, 500);
    await house.setFeeOwnerRate(houseFeeRate, { from: feeOwner });

    PLAYBurnRate = randombnBetween(1, 500);
    PLAYFeeRate = randombnBetween(1, 500);
    await PLAY.setBurnRate(PLAYBurnRate, { from: feeOwner });
    await PLAY.setFeeOwnerRate(PLAYFeeRate, { from: feeOwner });

    erc20 = await TestERC20.new({ from: owner });
    oracle = await TestBetOracle.new(house.address, { from: owner });
  });

  // Cases
  const cases = [
    {
      message: 'All win',
      players: [
        // Address           | Steps to Play | Option
        { address: accounts[0], playSteps: 3, option: 'A' },
        { address: accounts[1], playSteps: 3, option: 'A' },
        { address: accounts[2], playSteps: 1, option: 'A' },
        { address: accounts[3], playSteps: 3, option: 'A' },
        { address: accounts[4], playSteps: 1, option: 'A' },
        { address: accounts[5], playSteps: 3, option: 'A' },
        { address: accounts[6], playSteps: 2, option: 'A' },
        { address: accounts[7], playSteps: 4, option: 'A' },
        { address: accounts[8], playSteps: 1, option: 'A' },
        { address: accounts[9], playSteps: 1, option: 'A' },
      ],
      winOption: toOption('A'),
      minRate: bn(10000),
      maxRate: bn(20000),
    },
    {
      message: 'All lose/draw',
      players: [
        // Address           | Steps to Play | Option
        { address: accounts[0], playSteps: 3, option: 'F' },
        { address: accounts[1], playSteps: 3, option: 'A' },
        { address: accounts[2], playSteps: 1, option: 'F' },
        { address: accounts[3], playSteps: 3, option: 'H' },
        { address: accounts[4], playSteps: 1, option: 'D' },
        { address: accounts[5], playSteps: 3, option: 'A' },
        { address: accounts[6], playSteps: 2, option: 'C' },
        { address: accounts[7], playSteps: 4, option: 'A' },
        { address: accounts[8], playSteps: 1, option: 'A' },
        { address: accounts[9], playSteps: 1, option: 'H' },
      ],
      winOption: toOption('B'),
      minRate: bn(0),
      maxRate: bn(200),
    },
    // mixes
    {
      message: '1 win, 9 lose',
      players: [
        // Address           | Steps to Play | Option
        { address: accounts[0], playSteps: 3, option: 'A' },
        { address: accounts[1], playSteps: 3, option: 'H' },
        { address: accounts[2], playSteps: 1, option: 'L' },
        { address: accounts[3], playSteps: 3, option: 'J' },
        { address: accounts[4], playSteps: 1, option: 'E' },
        { address: accounts[5], playSteps: 3, option: 'H' },
        { address: accounts[6], playSteps: 2, option: 'C' },
        { address: accounts[7], playSteps: 4, option: 'H' },
        { address: accounts[8], playSteps: 1, option: 'H' },
        { address: accounts[9], playSteps: 1, option: 'F' },
      ],
      winOption: toOption('A'),
      minRate: bn(20000),
      maxRate: bn(20000),
    },
    {
      message: '9 win, 1 lose',
      players: [
        // Address           | Steps to Play | Option
        { address: accounts[0], playSteps: 3, option: 'A' },
        { address: accounts[1], playSteps: 3, option: 'A' },
        { address: accounts[2], playSteps: 1, option: 'A' },
        { address: accounts[3], playSteps: 3, option: 'A' },
        { address: accounts[4], playSteps: 1, option: 'A' },
        { address: accounts[5], playSteps: 3, option: 'B' },
        { address: accounts[6], playSteps: 2, option: 'A' },
        { address: accounts[7], playSteps: 4, option: 'A' },
        { address: accounts[8], playSteps: 1, option: 'A' },
        { address: accounts[9], playSteps: 1, option: 'A' },
      ],
      winOption: toOption('A'),
      minRate: bn(100),
      maxRate: bn(200),
    },
    {
      message: '6 win, 4 lose',
      players: [
        // Address           | Steps to Play | Option
        { address: accounts[0], playSteps: 3, option: 'A' },
        { address: accounts[1], playSteps: 3, option: 'A' },
        { address: accounts[2], playSteps: 1, option: 'A' },
        { address: accounts[3], playSteps: 3, option: 'A' },
        { address: accounts[4], playSteps: 1, option: 'A' },
        { address: accounts[5], playSteps: 3, option: 'A' },
        { address: accounts[6], playSteps: 2, option: 'C' },
        { address: accounts[7], playSteps: 4, option: 'B' },
        { address: accounts[8], playSteps: 1, option: 'B' },
        { address: accounts[9], playSteps: 1, option: 'H' },
      ],
      winOption: toOption('A'),
      minRate: bn(10000),
      maxRate: bn(20000),
    },
  ];

  for (let caseI = 0; caseI < cases.length; caseI++)
    it('Case ' + caseI + ': ' + cases[caseI].message, () => testCase(cases[caseI]));

  async function testCase (testCase) {
    const datas = processPlayer(testCase.players, testCase.winOption);
    const now = await time.latest();
    const startDecreaseRate = now;
    const noMoreBets = now.add(bn(300));
    const maxSetWinTime = now.add(bn(600));
    const minPlayAmount = bn(1000000);
    const minPlayAmountRateIncrease = bn(0);

    const betId = getId(minPlayAmount, minPlayAmountRateIncrease, startDecreaseRate, noMoreBets, maxSetWinTime, testCase.minRate, testCase.maxRate);
    await house.create(oracle.address, erc20.address, minPlayAmount, minPlayAmountRateIncrease, startDecreaseRate, noMoreBets, maxSetWinTime, testCase.minRate, testCase.maxRate, RETURN_TRUE, { from: feeOwner });

    // Plays
    for (let i = 0; i < datas.players.length; i++) {
      const players = datas.players[i];

      for (let j = 0; j < players.amountPlay.length; j++) {
        await setApproveBalance(players.address, players.amountPlay[j]);
        await house.play(betId, players.amountPlay[j], players.option, RETURN_TRUE, { from: players.address });
      }
    }

    await time.increaseTo((await house.bets(betId)).noMoreBets.add(bn(1)));
    await oracle.setWinOption(betId, datas.winOption);

    // Save and checks balances
    // const balGM = await erc20.balanceOf(house.address); // fails for the dust
    for (let i = 0; i < datas.players.length; i++) {
      expect(await house.getBetBalanceOf(betId, datas.players[i].address)).to.eq.BN(datas.expects[i].betPlayerBalance);
      const option = datas.players[i].option;
      expect(await house.getBetOptionBalance(betId, option)).to.eq.BN(datas.optionBalances[option]);
      datas.expects[i].prevPlayerBalance = await erc20.balanceOf(datas.players[i].address);
    }
    expect((await house.bets(betId)).totalBalance).to.eq.BN(datas.betBalance);

    // Collects
    for (let i = 0; i < datas.players.length; i++) {
      const player = datas.players[i];
      const option = await house.getBetOptionOf(betId, player.address);

      if (option === datas.winOption) { // win
        await house.collect(
          betId,
          RETURN_TRUE,
          { from: player.address },
        );
        expect(await house.getBetBalanceOf(betId, player.address)).to.eq.BN(0);
      } else if (datas.optionBalances[datas.winOption]) { // lose
        await expectRevert(
          house.collect(
            betId,
            RETURN_TRUE,
            { from: player.address },
          ),
          'House::collect: The sender lose or not play',
        );
        expect(await house.getBetBalanceOf(betId, player.address)).to.eq.BN(datas.expects[i].betPlayerBalance);
      } else { // draw
        await house.collect(
          betId,
          RETURN_TRUE,
          { from: player.address },
        );
        expect(await house.getBetBalanceOf(betId, player.address)).to.eq.BN(0);
      }
    }

    // Check ERC20 balance
    // expect(await erc20.balanceOf(house.address)).to.eq.BN(balGM.sub(datas.betBalance)); // fails for the dust
    for (let i = 0; i < datas.players.length; i++) {
      const player = datas.players[i];

      if (player.option === datas.winOption)  // win
        expect(await erc20.balanceOf(player.address)).to.eq.BN(
          (datas.expects[i].betPlayerBalance).mul(datas.betBalance).div(datas.optionBalances[player.option]).add(
            datas.expects[i].prevPlayerBalance,
          ),
        );
      else if (datas.optionBalances[datas.winOption])  // lose
        expect(await erc20.balanceOf(player.address)).to.eq.BN(datas.expects[i].prevPlayerBalance);
      else  // draw
        expect(await erc20.balanceOf(player.address)).to.eq.BN(datas.expects[i].prevPlayerBalance.add(datas.expects[i].betPlayerBalance));
    }
  }
});
